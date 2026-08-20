/** O webhook só pode confirmar fallback sem worker quando efeitos externos estão bloqueados. */
import { afterEach, describe, expect, it } from 'vitest'
import { enqueueInstagramWebhook, enqueueWhatsAppWebhook } from './queue.server'

const originalEnv = {
  DEMO_MODE: process.env.DEMO_MODE,
  REDIS_URL: process.env.REDIS_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('enqueueInstagramWebhook', () => {
  it('permite memória apenas no modo demo', async () => {
    delete process.env.REDIS_URL
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.DEMO_MODE = 'true'

    await expect(enqueueInstagramWebhook({}, '{}')).resolves.toMatchObject({
      backend: 'demo-memory',
    })
  })

  it('aplica a mesma fronteira segura ao webhook do WhatsApp', async () => {
    delete process.env.REDIS_URL
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.DEMO_MODE = 'true'

    await expect(
      enqueueWhatsAppWebhook(
        { object: 'whatsapp_business_account', entry: [] },
        '{"object":"whatsapp_business_account","entry":[]}',
      ),
    ).resolves.toMatchObject({ backend: 'demo-memory' })
  })

  it('falha fechado em live quando não há Redis nem reconciliador do outbox', async () => {
    delete process.env.REDIS_URL
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.DEMO_MODE = 'false'

    await expect(enqueueInstagramWebhook({}, '{}')).rejects.toThrow(
      'redis_required_for_live_webhook',
    )
  })
})
