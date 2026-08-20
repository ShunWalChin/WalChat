/** Probes server-only que distinguem configuração declarada de dependência disponível. */
import '@tanstack/react-start/server-only'
import IORedis from 'ioredis'
import { hasValidCredentialEncryptionKey } from './credentials-crypto.server'
import { getServerEnv } from './env.server'
import { getSupabaseAdmin } from './supabase-admin.server'

export type DependencyStatus = 'up' | 'down' | 'not_configured'

export type DependencyCheck = {
  status: DependencyStatus
  latencyMs: number
  reason?: 'missing_configuration' | 'timeout' | 'unavailable'
}

type ProbeInput = {
  configured: boolean
  required: boolean
  timeoutMs: number
  probe: () => Promise<void>
  now?: () => number
}

/** Executa um probe com timeout e devolve somente causas sanitizadas. */
export async function runDependencyProbe({
  configured,
  required,
  timeoutMs,
  probe,
  now = Date.now,
}: ProbeInput): Promise<DependencyCheck> {
  const startedAt = now()
  if (!configured)
    return {
      status: required ? 'down' : 'not_configured',
      latencyMs: 0,
      reason: 'missing_configuration',
    }

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new DependencyTimeoutError()),
          timeoutMs,
        )
      }),
    ])
    return { status: 'up', latencyMs: Math.max(0, now() - startedAt) }
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.max(0, now() - startedAt),
      reason:
        error instanceof DependencyTimeoutError ? 'timeout' : 'unavailable',
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/** Readiness exige banco e Redis em live; em demo, dependências configuradas também são verificadas. */
export async function checkRuntimeReadiness(input?: {
  timeoutMs?: number
  supabaseProbe?: () => Promise<void>
  redisProbe?: () => Promise<void>
}) {
  const env = getServerEnv()
  const live = env.DEMO_MODE === 'false'
  const timeoutMs = input?.timeoutMs ?? 2_000
  const supabaseConfigured = Boolean(
    env.SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.SUPABASE_PUBLISHABLE_KEY,
  )
  const redisConfigured = Boolean(env.REDIS_URL)

  const [supabase, redis] = await Promise.all([
    runDependencyProbe({
      configured: supabaseConfigured,
      required: live,
      timeoutMs,
      probe: input?.supabaseProbe ?? probeSupabase,
    }),
    runDependencyProbe({
      configured: redisConfigured,
      required: live,
      timeoutMs,
      probe: input?.redisProbe ?? probeRedis,
    }),
  ])
  const checks = { supabase, redis }
  const ok = Object.values(checks).every(
    (check) =>
      check.status === 'up' || (!live && check.status === 'not_configured'),
  )

  return {
    ok,
    status: ok ? ('ready' as const) : ('not_ready' as const),
    mode: live ? ('live' as const) : ('demo' as const),
    checks,
    capabilities: {
      metaConfigured: Boolean(
        env.META_APP_ID && env.META_APP_SECRET && env.META_VERIFY_TOKEN,
      ),
      instagramConfigured: Boolean(
        env.META_APP_ID && env.META_APP_SECRET && env.META_VERIFY_TOKEN,
      ),
      whatsappEmbeddedSignupConfigured: Boolean(
        env.META_APP_ID &&
        env.META_APP_SECRET &&
        env.META_VERIFY_TOKEN &&
        env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID,
      ),
      credentialEncryptionConfigured: hasValidCredentialEncryptionKey(),
      openaiConfigured: Boolean(env.OPENAI_API_KEY),
      geminiConfigured: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
    },
  }
}

async function probeSupabase() {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('supabase_not_configured')
  const { error } = await supabase.from('workspaces').select('id').limit(1)
  if (error) throw new Error('supabase_unavailable')
}

async function probeRedis() {
  const redisUrl = getServerEnv().REDIS_URL
  if (!redisUrl) throw new Error('redis_not_configured')
  const connection = new IORedis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 1_500,
    commandTimeout: 1_500,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
  })
  // O probe devolve um estado sanitizado; impede o cliente de logar host/porta por conta própria.
  connection.on('error', () => undefined)
  try {
    await connection.connect()
    await connection.ping()
  } finally {
    connection.disconnect()
  }
}

class DependencyTimeoutError extends Error {}
