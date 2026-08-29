/** Caracterização da semântica de readiness sem depender de rede, Redis ou banco. */
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkRuntimeReadiness,
  runDependencyProbe,
} from './runtime-health.server'

const originalEnv = {
  DEMO_MODE: process.env.DEMO_MODE,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  REDIS_URL: process.env.REDIS_URL,
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('runDependencyProbe', () => {
  it('distingue configuração ausente opcional de dependência indisponível', async () => {
    const skipped = await runDependencyProbe({
      configured: false,
      required: false,
      timeoutMs: 10,
      probe: async () => undefined,
    })
    const required = await runDependencyProbe({
      configured: false,
      required: true,
      timeoutMs: 10,
      probe: async () => undefined,
    })

    expect(skipped).toMatchObject({
      status: 'not_configured',
      reason: 'missing_configuration',
    })
    expect(required).toMatchObject({
      status: 'down',
      reason: 'missing_configuration',
    })
  })

  it('sanitiza falha e timeout sem devolver mensagem interna', async () => {
    const unavailable = await runDependencyProbe({
      configured: true,
      required: true,
      timeoutMs: 20,
      probe: async () => {
        throw new Error('postgresql://segredo@host/banco')
      },
    })
    const timeout = await runDependencyProbe({
      configured: true,
      required: true,
      timeoutMs: 1,
      probe: async () => new Promise(() => undefined),
    })

    expect(unavailable).toMatchObject({
      status: 'down',
      reason: 'unavailable',
    })
    expect(timeout).toMatchObject({ status: 'down', reason: 'timeout' })
    expect(JSON.stringify({ unavailable, timeout })).not.toContain('segredo')
  })
})

describe('checkRuntimeReadiness', () => {
  it('permite demo sem dependências, mas exige ambas em live', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_PUBLISHABLE_KEY
    delete process.env.REDIS_URL

    process.env.DEMO_MODE = 'true'
    const demo = await checkRuntimeReadiness()
    process.env.DEMO_MODE = 'false'
    const live = await checkRuntimeReadiness()

    expect(demo).toMatchObject({ ok: true, status: 'ready', mode: 'demo' })
    expect(live).toMatchObject({
      ok: false,
      status: 'not_ready',
      mode: 'live',
    })
  })

  it('reprova uma dependência configurada que não responde mesmo em demo', async () => {
    process.env.DEMO_MODE = 'true'
    process.env.SUPABASE_URL = 'https://supabase.example'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'.repeat(24)
    process.env.SUPABASE_PUBLISHABLE_KEY = 'y'.repeat(24)
    process.env.REDIS_URL = 'redis://redis:6379'

    const readiness = await checkRuntimeReadiness({
      supabaseProbe: async () => {
        throw new Error('connection_refused')
      },
      redisProbe: async () => undefined,
    })

    expect(readiness.ok).toBe(false)
    expect(readiness.checks.supabase).toMatchObject({
      status: 'down',
      reason: 'unavailable',
    })
    expect(readiness.checks.redis.status).toBe('up')
  })
})

describe('capacidades de IA no readiness', () => {
  const anterior = { ...process.env }
  afterEach(() => {
    process.env = { ...anterior }
  })

  it('reporta configurado quando a chave está guardada no cofre do workspace', async () => {
    delete process.env.OPENAI_API_KEY
    // O runtime resolve pelo cofre antes de olhar o ambiente; reportar só o
    // ambiente fazia o readiness negar um provedor que estava funcionando.
    const readiness = await checkRuntimeReadiness({
      supabaseProbe: async () => undefined,
      redisProbe: async () => undefined,
      storedCredentialProbe: async (provider) => provider === 'openai',
    })
    expect(readiness.capabilities.openaiConfigured).toBe(true)
    expect(readiness.capabilities.geminiConfigured).toBe(false)
  })

  it('não pendura o healthcheck quando a consulta ao cofre trava', async () => {
    delete process.env.OPENAI_API_KEY
    const readiness = await checkRuntimeReadiness({
      timeoutMs: 30,
      supabaseProbe: async () => undefined,
      redisProbe: async () => undefined,
      // Consulta que nunca resolve: o readiness precisa responder mesmo assim.
      storedCredentialProbe: () => new Promise<boolean>(() => undefined),
    })
    expect(readiness.capabilities.openaiConfigured).toBe(false)
  })
})
