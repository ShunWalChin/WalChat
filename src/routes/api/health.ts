/** Liveness sem I/O: confirma que o processo responde, não que dependências estão prontas. */
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
            status: 'alive',
            service: 'wal-chat',
            timestamp: new Date().toISOString(),
            configuredIntegrations: {
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
            readinessUrl: '/api/ready',
          },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      },
    },
  },
})
