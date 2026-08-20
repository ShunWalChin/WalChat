/** Revalida token, perfil e campos de webhook de uma conta já conectada. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import {
  getMetaAccountAccess,
  writeIntegrationAudit,
} from '../../../../server/integration-credentials.server'
import {
  getMetaOwnProfile,
  getMetaWebhookSubscriptions,
  META_WEBHOOK_FIELDS,
  subscribeMetaWebhooks,
} from '../../../../server/meta-api.server'

const schema = z.object({ accountId: z.string().uuid() })

export const Route = createFileRoute('/api/integrations/meta/validate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = schema.parse(await request.json())
          const access = await getMetaAccountAccess({
            workspaceId: context.workspaceId,
            instagramAccountId: body.accountId,
          })
          const profile = await getMetaOwnProfile(access.accessToken)
          await subscribeMetaWebhooks({
            instagramUserId: access.instagramUserId,
            accessToken: access.accessToken,
          })
          const subscriptions = await getMetaWebhookSubscriptions({
            instagramUserId: access.instagramUserId,
            accessToken: access.accessToken,
          })
          const subscribedFields = Array.from(
            new Set(
              (subscriptions.data ?? []).flatMap(
                (item) => item.subscribed_fields ?? [],
              ),
            ),
          )
          const missingFields = META_WEBHOOK_FIELDS.filter(
            (field) => !subscribedFields.includes(field),
          )
          const now = new Date().toISOString()
          const { error } = await context.supabase
            .from('instagram_accounts')
            .update({
              username: profile.username,
              display_name: profile.name ?? profile.username,
              profile_picture_url: profile.profile_picture_url ?? null,
              account_type: profile.account_type ?? null,
              status: 'connected',
              subscribed_fields: subscribedFields,
              permissions_validated_at: now,
              webhook_subscribed_at: now,
              last_sync_at: now,
              connection_error:
                missingFields.length > 0
                  ? `Campos ausentes: ${missingFields.join(', ')}`
                  : null,
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.accountId)
          if (error) throw error
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'meta',
            action: 'connection_validated',
            status: missingFields.length ? 'failure' : 'success',
            resourceId: body.accountId,
            details: { missingFields },
          })
          return Response.json({
            ok: missingFields.length === 0,
            profile,
            subscribedFields,
            missingFields,
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao validar a conexão Meta.')
        }
      },
    },
  },
})
