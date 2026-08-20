/** Desconecta webhooks e remove o token cifrado sem apagar dados históricos. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import {
  deleteIntegrationCredential,
  getMetaAccountAccess,
  writeIntegrationAudit,
} from '../../../../server/integration-credentials.server'
import { unsubscribeMetaWebhooks } from '../../../../server/meta-api.server'
import { readJsonBody } from '../../../../server/request-body.server'

const schema = z.object({ accountId: z.string().uuid() })

export const Route = createFileRoute('/api/integrations/meta/disconnect')({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = schema.parse(await readJsonBody(request))
          const access = await getMetaAccountAccess({
            workspaceId: context.workspaceId,
            instagramAccountId: body.accountId,
          })
          try {
            await unsubscribeMetaWebhooks({
              instagramUserId: access.instagramUserId,
              accessToken: access.accessToken,
            })
          } catch (error) {
            console.warn(
              JSON.stringify({
                event: 'meta_unsubscribe_failed',
                error: error instanceof Error ? error.name : 'unknown_error',
              }),
            )
          }
          const { error } = await context.supabase
            .from('instagram_accounts')
            .update({
              status: 'disconnected',
              subscribed_fields: [],
              connection_error: null,
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.accountId)
          if (error) throw error
          await deleteIntegrationCredential({
            workspaceId: context.workspaceId,
            provider: 'meta',
            credentialType: 'access_token',
            scopeKey: body.accountId,
          })
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'meta',
            action: 'disconnected',
            status: 'success',
            resourceId: body.accountId,
          })
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao desconectar a conta.')
        }
      },
    },
  },
})
