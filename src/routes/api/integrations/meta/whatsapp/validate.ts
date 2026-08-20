/** Revalida token, WABA, telefone, scopes e assinatura do webhook. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../../server/api-auth.server'
import { getServerEnv } from '../../../../../server/env.server'
import {
  getWhatsAppAccountAccess,
  writeIntegrationAudit,
} from '../../../../../server/integration-credentials.server'
import { readJsonBody } from '../../../../../server/request-body.server'
import {
  WHATSAPP_REQUIRED_SCOPES,
  WHATSAPP_WEBHOOK_FIELDS,
  debugWhatsAppAccessToken,
  getWhatsAppBusinessAccountSubscriptions,
  getWhatsAppPhoneNumber,
  subscribeWhatsAppBusinessAccount,
  whatsappSubscriptionsIncludeApp,
  whatsappTokenTargetsWaba,
} from '../../../../../server/whatsapp-api.server'

const schema = z.object({ accountId: z.string().uuid() })

export const Route = createFileRoute(
  '/api/integrations/meta/whatsapp/validate',
)({
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
          const account = await getWhatsAppAccountAccess({
            workspaceId: context.workspaceId,
            whatsappAccountId: body.accountId,
            allowNonConnected: true,
          })
          const debug = await debugWhatsAppAccessToken(account.accessToken)
          const env = getServerEnv()
          const scopes = debug.data.scopes ?? []
          const missingScopes = WHATSAPP_REQUIRED_SCOPES.filter(
            (scope) => !scopes.includes(scope),
          )
          const identityValid = Boolean(
            debug.data.is_valid &&
            debug.data.app_id === env.META_APP_ID &&
            whatsappTokenTargetsWaba(
              debug.data.granular_scopes,
              account.wabaId,
            ),
          )
          await getWhatsAppPhoneNumber({
            wabaId: account.wabaId,
            phoneNumberId: account.phoneNumberId,
            accessToken: account.accessToken,
          })
          const subscription = await subscribeWhatsAppBusinessAccount({
            wabaId: account.wabaId,
            accessToken: account.accessToken,
          })
          const subscriptions = await getWhatsAppBusinessAccountSubscriptions({
            wabaId: account.wabaId,
            accessToken: account.accessToken,
          })
          const subscribed = Boolean(
            subscription.success &&
            env.META_APP_ID &&
            whatsappSubscriptionsIncludeApp(
              subscriptions.data,
              env.META_APP_ID,
            ),
          )
          const ok = identityValid && missingScopes.length === 0 && subscribed
          const now = new Date().toISOString()
          const { error } = await context.admin
            .from('whatsapp_accounts')
            .update({
              status: ok ? 'connected' : 'expired',
              scopes,
              subscribed_fields: subscribed ? WHATSAPP_WEBHOOK_FIELDS : [],
              permissions_validated_at:
                identityValid && missingScopes.length === 0 ? now : null,
              webhook_subscribed_at: subscribed ? now : null,
              last_sync_at: now,
              connection_error: ok ? null : 'whatsapp_validation_failed',
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.accountId)
          if (error) throw error
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'meta',
            action: 'whatsapp_connection_validated',
            status: ok ? 'success' : 'failure',
            resourceId: body.accountId,
            details: { missingScopes, subscribed, identityValid },
          })
          return Response.json({ ok, missingScopes, subscribed, identityValid })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Não foi possível validar a conexão do WhatsApp.',
          )
        }
      },
    },
  },
})
