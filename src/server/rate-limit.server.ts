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
  }
  return redisClient
}

/**
 * Espera o cliente ficar pronto, no arranque.
 *
 * `enableOfflineQueue: false` é proposital: com o Redis fora, os comandos devem
 * falhar na hora em vez de empilhar. Só que a mesma regra vale enquanto a
 * conexão ainda está sendo aberta — e aí ela pune o caso errado. Como a política
 * é falhar fechada, a primeira requisição depois de cada deploy levava 503 sem
 * que nada estivesse quebrado.
 *
 * A espera é curta e só acontece quando o cliente ainda não ficou pronto uma
 * vez. Com o Redis realmente fora, o estado é `end` ou `close` e a função
 * devolve na hora, preservando a falha rápida.
 */
async function esperarConexao(client: IORedis) {
  if (client.status === 'ready') return true
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
