/** Desassina a WABA e elimina a credencial cifrada do workspace. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../../server/api-auth.server'
import {
  deleteIntegrationCredential,
  getIntegrationCredential,
  writeIntegrationAudit,
} from '../../../../../server/integration-credentials.server'
import { readJsonBody } from '../../../../../server/request-body.server'
import { unsubscribeWhatsAppBusinessAccount } from '../../../../../server/whatsapp-api.server'

const schema = z.object({ accountId: z.string().uuid() })

export const Route = createFileRoute(
  '/api/integrations/meta/whatsapp/disconnect',
)({
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
          const { data: account, error } = await context.supabase
            .from('whatsapp_accounts')
            .select('id,waba_id')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.accountId)
            .maybeSingle()
          if (error) throw error
          if (!account)
            return Response.json(
              { error: 'Conta WhatsApp não encontrada.' },
              { status: 404 },
            )
          const credential = await getIntegrationCredential({
            workspaceId: context.workspaceId,
            provider: 'meta',
            credentialType: 'access_token',
            scopeKey: account.id,
          })
          let remoteUnsubscribed = false
          if (credential?.value)
            remoteUnsubscribed = await unsubscribeWhatsAppBusinessAccount({
              wabaId: account.waba_id,
              accessToken: credential.value,
            })
              .then((result) => Boolean(result.success))
              .catch(() => false)
          await deleteIntegrationCredential({
            workspaceId: context.workspaceId,
            provider: 'meta',
            credentialType: 'access_token',
            scopeKey: account.id,
          })
          const { error: updateError } = await context.admin
            .from('whatsapp_accounts')
            .update({
              status: 'disconnected',
              subscribed_fields: [],
              webhook_subscribed_at: null,
              connection_error: remoteUnsubscribed
                ? null
                : 'remote_unsubscribe_not_confirmed',
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', account.id)
          if (updateError) throw updateError
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'meta',
            action: 'whatsapp_disconnected',
            status: 'success',
            resourceId: account.id,
            details: { remoteUnsubscribed },
          })
          return Response.json({ disconnected: true, remoteUnsubscribed })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Não foi possível desconectar o WhatsApp.',
          )
        }
      },
    },
  },
})
