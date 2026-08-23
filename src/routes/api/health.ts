/** Liveness sem I/O: confirma que o processo responde, não que dependências estão prontas. */
import { createFileRoute } from '@tanstack/react-router'
import {
  getInstagramAppConfig,
  getServerEnv,
  getWhatsAppAppConfig,
} from '../../server/env.server'
import { hasValidCredentialEncryptionKey } from '../../server/credentials-crypto.server'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const env = getServerEnv()
        const instagram = getInstagramAppConfig(env)
        const whatsapp = getWhatsAppAppConfig(env)
        const instagramConfigured = Boolean(
          instagram.appId && instagram.appSecret && instagram.verifyToken,
        )
        const whatsappConfigured = Boolean(
          whatsapp.appId && whatsapp.appSecret && whatsapp.verifyToken,
        )
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
              meta: instagramConfigured || whatsappConfigured,
              instagram: instagramConfigured,
              whatsapp: whatsappConfigured,
              credentialEncryption: hasValidCredentialEncryptionKey(),
              openai: Boolean(env.OPENAI_API_KEY),
              gemini: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
              googleWorkspace: Boolean(
                env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
              ),
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
