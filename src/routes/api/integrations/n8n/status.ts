/** Estado sanitizado e telemetria recente da conexão n8n. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { getServerEnv } from '../../../../server/env.server'
import {
  getN8nConnection,
  n8nCredentialPresence,
  sanitizedN8nHost,
} from '../../../../server/n8n-integration.server'

export const Route = createFileRoute('/api/integrations/n8n/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const connection = await getN8nConnection(
            context.workspaceId,
            context.admin,
          )
          const credentials = connection
            ? await n8nCredentialPresence(
                context.workspaceId,
                connection.id,
                context.admin,
              )
            : { apiKey: false, outboundWebhook: false, signingSecret: false }
          const { data: recent, error } = connection
            ? await context.admin
                .from('integration_webhook_deliveries')
                .select(
                  'direction,status,event_type,http_status,attempt_count,created_at',
                )
                .eq('workspace_id', context.workspaceId)
                .eq('connection_id', connection.id)
                .order('created_at', { ascending: false })
                .limit(20)
            : { data: [], error: null }
          if (error) throw error
          const env = getServerEnv()
          return Response.json(
            {
              managedDefaultAvailable: Boolean(
                env.N8N_BASE_URL &&
                env.N8N_API_KEY &&
                env.N8N_WEBHOOK_SIGNING_SECRET,
              ),
              permissions: {
                canManage: context.role === 'owner' || context.role === 'admin',
              },
              connection: connection
                ? {
                    id: connection.id,
                    name: connection.name,
                    host: sanitizedN8nHost(connection.base_url),
                    status: connection.status,
                    detectedVersion: connection.detected_version,
                    eventSubscriptions: connection.event_subscriptions,
                    lastValidatedAt: connection.last_validated_at,
                    lastEventAt: connection.last_event_at,
                    lastError: connection.last_error,
                    inboundWebhookUrl: `${env.APP_ORIGIN}/api/public/webhooks/n8n/${connection.id}`,
                    credentials,
                  }
                : null,
              recentDeliveries: recent,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar a conexão n8n.')
        }
      },
    },
  },
})
