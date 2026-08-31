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
