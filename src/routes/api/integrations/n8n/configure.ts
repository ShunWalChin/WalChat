/** Configura e valida o n8n sem devolver credenciais persistidas. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { n8nConfigureSchema } from '../../../../server/n8n-contract'
import { configureN8nConnection } from '../../../../server/n8n-integration.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

export const Route = createFileRoute('/api/integrations/n8n/configure')({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'n8n-configure',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 10,
            windowSeconds: 300,
          })
          const configuration = n8nConfigureSchema.parse(
            await readJsonBody(request),
          )
          const result = await configureN8nConnection({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            configuration,
          })
          return Response.json(result, {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao configurar a conexão n8n.')
        }
      },
    },
  },
})
