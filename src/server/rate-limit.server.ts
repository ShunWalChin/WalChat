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
