/** Testa separadamente a API administrativa ou o webhook outbound do n8n. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { n8nTestSchema } from '../../../../server/n8n-contract'
import {
  probeStoredN8nConnection,
  sendN8nEvent,
} from '../../../../server/n8n-integration.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

export const Route = createFileRoute('/api/integrations/n8n/test')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'n8n-test',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 20,
            windowSeconds: 300,
          })
          const body = n8nTestSchema.parse(await readJsonBody(request))
          const result =
            body.mode === 'api'
              ? await probeStoredN8nConnection(context.workspaceId)
              : await sendN8nEvent({
                  workspaceId: context.workspaceId,
                  eventType: 'integration.test',
                  payload: {
                    message: 'Teste de conectividade iniciado pelo wizard.',
                  },
                })
          return Response.json({ ok: true, result })
        } catch (error) {
          return apiErrorResponse(error, 'O teste da conexão n8n falhou.')
        }
      },
    },
  },
})
