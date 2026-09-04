/** SLOs agregados da operação sem expor payloads nem segredos. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'

export const Route = createFileRoute('/api/operations/slo')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const { data, error } = await context.admin.rpc(
            'workspace_operational_slos',
            { target_workspace_id: context.workspaceId },
          )
          if (error) throw error
          return Response.json(data, {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao calcular os SLOs.')
        }
      },
    },
  },
})
