/** Saída autenticada para eventos de negócio explicitamente assinados ao n8n. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { n8nDispatchSchema } from '../../../../server/n8n-contract'
import { sendN8nEvent } from '../../../../server/n8n-integration.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

export const Route = createFileRoute('/api/integrations/n8n/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          await assertRateLimit({
            namespace: 'n8n-dispatch',
            identity: context.workspaceId,
            limit: 120,
            windowSeconds: 60,
          })
          const body = n8nDispatchSchema.parse(await readJsonBody(request))
          const result = await sendN8nEvent({
            workspaceId: context.workspaceId,
            eventType: body.eventType,
            payload: body.payload,
            deliveryId: body.deliveryId,
          })
          return Response.json(result, { status: result.skipped ? 200 : 202 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao encaminhar evento ao n8n.')
        }
      },
    },
  },
})
