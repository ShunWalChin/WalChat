/** Remove conexão e credenciais n8n do workspace. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { disconnectN8nConnection } from '../../../../server/n8n-integration.server'

export const Route = createFileRoute('/api/integrations/n8n/disconnect')({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const disconnected = await disconnectN8nConnection({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
          })
          return Response.json({ ok: true, disconnected })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao desconectar o n8n.')
        }
      },
    },
  },
})
