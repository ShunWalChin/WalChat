/** Desconecta o Google e elimina access/refresh tokens cifrados. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import {
  getIntegrationCredential,
  deleteIntegrationCredential,
  writeIntegrationAudit,
} from '../../../../server/integration-credentials.server'
import { revokeGoogleToken } from '../../../../server/google-calendar.server'
import { readJsonBody } from '../../../../server/request-body.server'

const schema = z.object({ connectionId: z.uuid() })

export const Route = createFileRoute('/api/integrations/google/disconnect')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = schema.parse(await readJsonBody(request))
          const connection = await context.admin
            .from('calendar_connections')
            .select('id')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.connectionId)
            .maybeSingle()
          if (connection.error) throw connection.error
          if (!connection.data)
            return Response.json(
              { error: 'Conexão não encontrada.' },
              { status: 404 },
            )
          const refreshToken = await getIntegrationCredential({
            workspaceId: context.workspaceId,
            provider: 'google',
            credentialType: 'refresh_token',
            scopeKey: body.connectionId,
          })
          let revokedAtProvider = false
          if (refreshToken?.value) {
            try {
              await revokeGoogleToken(refreshToken.value)
              revokedAtProvider = true
            } catch {
              // A indisponibilidade externa não pode impedir a eliminação
              // imediata dos tokens no cofre local.
            }
          }
          await Promise.all([
            deleteIntegrationCredential({
              workspaceId: context.workspaceId,
              provider: 'google',
              credentialType: 'access_token',
              scopeKey: body.connectionId,
            }),
            deleteIntegrationCredential({
              workspaceId: context.workspaceId,
              provider: 'google',
              credentialType: 'refresh_token',
              scopeKey: body.connectionId,
            }),
          ])
          const { error } = await context.admin
            .from('calendar_connections')
            .update({
              status: 'disconnected',
              sync_token: null,
              connection_error: null,
            })
            .eq('id', body.connectionId)
          if (error) throw error
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'google',
            action: 'calendar_disconnected',
            status: 'success',
            resourceId: body.connectionId,
            details: { revokedAtProvider },
          })
          return Response.json({
            ok: true,
            warning: revokedAtProvider
              ? null
              : 'A conexão local foi removida; confirme a revogação também na Conta Google.',
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao desconectar o Google.')
        }
      },
    },
  },
})
