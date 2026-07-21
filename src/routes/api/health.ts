/** Health check sem secrets; informa apenas presença de configuração e modo operacional. */
import { createFileRoute } from '@tanstack/react-router'
import { getServerEnv } from '../../server/env.server'
import { hasValidCredentialEncryptionKey } from '../../server/credentials-crypto.server'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const env = getServerEnv()
        return Response.json(
          {
            ok: true,
            service: 'wal-chat',
            timestamp: new Date().toISOString(),
            integrations: {
              supabase: Boolean(
                env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY,
              ),
              redis: Boolean(env.REDIS_URL),
              meta: Boolean(env.META_APP_SECRET && env.META_VERIFY_TOKEN),
              credentialEncryption: hasValidCredentialEncryptionKey(),
              openai: Boolean(env.OPENAI_API_KEY),
              gemini: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
            },
            mode: env.DEMO_MODE === 'true' ? 'demo' : 'live',
          },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      },
    },
  },
})
