/** Rate limiting distribuído para endpoints caros/sensíveis, com fallback local. */
import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import IORedis from 'ioredis'
import { ApiError } from './api-auth.server'
import { getServerEnv } from './env.server'

type LimitInput = {
  namespace: string
  identity: string
  limit: number
  windowSeconds: number
}

let redisClient: IORedis | undefined
/**
 * Se a conexao ja ficou pronta alguma vez neste processo.
 *
 * E o que separa arranque de queda. Antes disso, `esperarConexao` esperava
 * sempre que o estado nao fosse `ready` — e durante uma queda o ioredis fica em
 * `reconnecting`, nao em `end`, entao TODA requisicao pagava os dois segundos
 * antes de falhar. Com trafego, a indisponibilidade do Redis virava lentidao
 * geral do app.
 */
let jaConectou = false
const memoryWindows = new Map<string, { count: number; expiresAt: number }>()

/** Margem abaixo do teto de 750 Private Replies/h usado pelo OpenReply. */
export const INSTAGRAM_PRIVATE_REPLY_LIMIT = 700
const INSTAGRAM_PRIVATE_REPLY_WINDOW_SECONDS = 60 * 60

export class InstagramPrivateReplyRateLimitError extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super('instagram_private_reply_rate_limited')
    this.name = 'InstagramPrivateReplyRateLimitError'
    this.retryAfterMs = Math.max(1_000, retryAfterMs)
  }
}

export function privateReplyLimitDecision(currentCount: number) {
  return {
    allowed: currentCount < INSTAGRAM_PRIVATE_REPLY_LIMIT,
    remaining: Math.max(0, INSTAGRAM_PRIVATE_REPLY_LIMIT - currentCount),
  }
}

function redis() {
  const url = getServerEnv().REDIS_URL
  if (!url) return null
  if (!redisClient) {
    redisClient = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
      enableOfflineQueue: false,
    })
    redisClient.on('error', () => undefined)
    redisClient.on('ready', () => {
      jaConectou = true
    })
  }
  return redisClient
}

/**
 * Espera o cliente ficar pronto, e somente no arranque.
 *
 * `enableOfflineQueue: false` e proposital: com o Redis fora, os comandos devem
 * falhar na hora em vez de empilhar. So que a mesma regra vale enquanto a
 * conexao ainda esta sendo aberta — e ai ela pune o caso errado. Como a
 * politica e falhar fechada, a primeira requisicao depois de cada deploy levava
 * 503 sem que nada estivesse quebrado.
 *
 * A espera acontece uma unica vez na vida do processo, antes da primeira
 * conexao. Depois dela, `jaConectou` e verdadeiro e a funcao devolve na hora:
 * durante uma queda o estado e `reconnecting`, e esperar dois segundos por
 * requisicao transformaria a queda do Redis em lentidao de tudo.
 */
async function esperarConexao(client: IORedis) {
  if (client.status === 'ready') return true
  // Depois da primeira conexao bem-sucedida, qualquer estado diferente de
  // `ready` e uma queda, e queda deve falhar rapido. A espera existe so para o
  // arranque, quando ainda nao houve conexao nenhuma.
  if (jaConectou) return false
  if (client.status === 'end' || client.status === 'close') return false
  return new Promise<boolean>((resolve) => {
    const encerrar = (pronto: boolean) => {
      clearTimeout(prazo)
      client.off('ready', aoConectar)
      client.off('error', aoFalhar)
      resolve(pronto)
    }
    const aoConectar = () => encerrar(true)
    const aoFalhar = () => encerrar(false)
    const prazo = setTimeout(() => encerrar(false), 2_000)
    client.once('ready', aoConectar)
    client.once('error', aoFalhar)
  })
}

/**
 * Compartilhados com o monitor de cota por aplicativo da Meta.
 *
 * Abrir um segundo `IORedis` seria outra conexão TCP para o mesmo Redis, e a
 * política de espera no arranque precisa ser exatamente esta — a de lá herda a
 * correção que impede a queda do Redis de virar lentidão geral.
 */
export { redis as redisCompartilhado, esperarConexao as esperarRedis }

function opaqueKey(input: LimitInput) {
  const identityHash = createHash('sha256').update(input.identity).digest('hex')
  return `walchat:limit:${input.namespace}:${identityHash}`
}

/** Fixed window atômica no Redis. Em live, indisponibilidade falha fechada. */
export async function assertRateLimit(input: LimitInput) {
  const key = opaqueKey(input)
  const client = redis()
  let count: number
  if (client) {
    // No arranque a conexão ainda está abrindo; contar antes disso seria
    // recusar tráfego legítimo por um motivo que não existe.
    if (client.status !== 'ready') await esperarConexao(client)
    try {
      count = Number(
        await client.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
          1,
          key,
          input.windowSeconds,
        ),
      )
    } catch {
      if (getServerEnv().DEMO_MODE === 'false')
        throw new ApiError(
          503,
          'Proteção de tráfego temporariamente indisponível.',
        )
      count = incrementMemory(key, input.windowSeconds)
    }
  } else {
    count = incrementMemory(key, input.windowSeconds)
  }
  if (count > input.limit)
    throw new ApiError(429, 'Muitas requisições. Aguarde e tente novamente.')
}

const RESERVE_LIMIT_SLOT_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local maximum = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
if current >= maximum then
  local remaining = redis.call('PTTL', KEYS[1])
  if remaining < 1 then remaining = ttl * 1000 end
  return {0, current, remaining}
end
local next_count = redis.call('INCR', KEYS[1])
if next_count == 1 then redis.call('EXPIRE', KEYS[1], ttl) end
local remaining = redis.call('PTTL', KEYS[1])
return {1, next_count, remaining}
`

/**
 * Reserva atômica exclusiva do endpoint de Private Reply.
 * Em live, Redis indisponível bloqueia o envio em vez de perder o limite global.
 */
export async function reserveInstagramPrivateReplySlot(
  instagramAccountId: string,
) {
  const key = opaqueKey({
    namespace: 'instagram-private-reply-account',
    identity: instagramAccountId,
    limit: INSTAGRAM_PRIVATE_REPLY_LIMIT,
    windowSeconds: INSTAGRAM_PRIVATE_REPLY_WINDOW_SECONDS,
  })
  const client = redis()
  let allowed = false
  let count = 0
  let retryAfterMs = INSTAGRAM_PRIVATE_REPLY_WINDOW_SECONDS * 1_000

  if (client) {
    if (client.status !== 'ready') await esperarConexao(client)
    try {
      const raw = await client.eval(
        RESERVE_LIMIT_SLOT_SCRIPT,
        1,
        key,
        INSTAGRAM_PRIVATE_REPLY_LIMIT,
        INSTAGRAM_PRIVATE_REPLY_WINDOW_SECONDS,
      )
      const values = Array.isArray(raw) ? raw : []
      allowed = Number(values[0]) === 1
      count = Number(values[1] ?? 0)
      retryAfterMs = Number(values[2] ?? retryAfterMs)
    } catch {
      if (getServerEnv().DEMO_MODE === 'false')
        throw new ApiError(
          503,
          'Proteção de Private Reply temporariamente indisponível.',
        )
      ;({ allowed, count, retryAfterMs } = reserveMemorySlot(
        key,
        INSTAGRAM_PRIVATE_REPLY_LIMIT,
        INSTAGRAM_PRIVATE_REPLY_WINDOW_SECONDS,
      ))
    }
  } else {
    if (getServerEnv().DEMO_MODE === 'false')
      throw new ApiError(
        503,
        'Proteção de Private Reply temporariamente indisponível.',
      )
    ;({ allowed, count, retryAfterMs } = reserveMemorySlot(
      key,
      INSTAGRAM_PRIVATE_REPLY_LIMIT,
      INSTAGRAM_PRIVATE_REPLY_WINDOW_SECONDS,
    ))
  }
  if (!allowed) throw new InstagramPrivateReplyRateLimitError(retryAfterMs)
  return { count, remaining: INSTAGRAM_PRIVATE_REPLY_LIMIT - count }
}

function reserveMemorySlot(key: string, limit: number, windowSeconds: number) {
  const now = Date.now()
  const current = memoryWindows.get(key)
  if (!current || current.expiresAt <= now) {
    memoryWindows.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1_000,
    })
    return { allowed: true, count: 1, retryAfterMs: windowSeconds * 1_000 }
  }
  if (current.count >= limit)
    return {
      allowed: false,
      count: current.count,
      retryAfterMs: current.expiresAt - now,
    }
  current.count += 1
  return {
    allowed: true,
    count: current.count,
    retryAfterMs: current.expiresAt - now,
  }
}

function incrementMemory(key: string, windowSeconds: number) {
  const now = Date.now()
  const current = memoryWindows.get(key)
  if (!current || current.expiresAt <= now) {
    memoryWindows.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1_000,
    })
    return 1
  }
  current.count += 1
  // Limpeza oportunista mantém o fallback limitado durante desenvolvimento.
  if (memoryWindows.size > 10_000)
    for (const [entryKey, entry] of memoryWindows)
      if (entry.expiresAt <= now) memoryWindows.delete(entryKey)
  return current.count
}
