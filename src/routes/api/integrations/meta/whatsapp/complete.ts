/** Finaliza o Embedded Signup e só ativa a conta após validar todos os gates. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../../server/api-auth.server'
import { hasValidCredentialEncryptionKey } from '../../../../../server/credentials-crypto.server'
import { getServerEnv } from '../../../../../server/env.server'
import {
  deleteIntegrationCredential,
  saveIntegrationCredential,
  writeIntegrationAudit,
} from '../../../../../server/integration-credentials.server'
import { assertRateLimit } from '../../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../../server/request-body.server'
import {
  WHATSAPP_REQUIRED_SCOPES,
  WHATSAPP_WEBHOOK_FIELDS,
  debugWhatsAppAccessToken,
  exchangeWhatsAppEmbeddedSignupCode,
  getWhatsAppBusinessAccount,
  getWhatsAppBusinessAccountSubscriptions,
  getWhatsAppPhoneNumber,
  subscribeWhatsAppBusinessAccount,
  whatsappSubscriptionsIncludeApp,
  whatsappTokenTargetsWaba,
} from '../../../../../server/whatsapp-api.server'

const schema = z.object({
  code: z.string().trim().min(5).max(2_048),
  wabaId: z.string().regex(/^[0-9]{5,40}$/),
  phoneNumberId: z.string().regex(/^[0-9]{5,40}$/),
  businessId: z
    .string()
    .regex(/^[0-9]{5,40}$/)
    .optional(),
})

export const Route = createFileRoute(
  '/api/integrations/meta/whatsapp/complete',
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let accountId: string | null = null
        let context: Awaited<
          ReturnType<typeof requireWorkspaceContext>
        > | null = null
        try {
          assertTrustedOrigin(request)
          context = await requireWorkspaceContext(request, ['owner', 'admin'])
          await assertRateLimit({
            namespace: 'whatsapp-embedded-signup',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 5,
            windowSeconds: 600,
          })
          const env = getServerEnv()
          if (
            !env.META_APP_ID ||
            !env.META_APP_SECRET ||
            !env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
          )
            return Response.json(
              { error: 'Embedded Signup do WhatsApp não está configurado.' },
              { status: 503 },
            )
          if (!hasValidCredentialEncryptionKey())
            return Response.json(
              { error: 'Cofre de credenciais não está configurado.' },
              { status: 503 },
            )

          const body = schema.parse(await readJsonBody(request))
          const token = await exchangeWhatsAppEmbeddedSignupCode(body.code)
          const debug = await debugWhatsAppAccessToken(token.access_token)
          if (!debug.data.is_valid || debug.data.app_id !== env.META_APP_ID)
            return Response.json(
              { error: 'O token retornado não pertence a este aplicativo.' },
              { status: 422 },
            )
          const scopes = debug.data.scopes ?? []
          const missingScopes = WHATSAPP_REQUIRED_SCOPES.filter(
            (scope) => !scopes.includes(scope),
          )
          if (missingScopes.length > 0)
            return Response.json(
              {
                error: 'Permissões obrigatórias não foram concedidas.',
                missingScopes,
              },
              { status: 422 },
            )
          if (
            !whatsappTokenTargetsWaba(debug.data.granular_scopes, body.wabaId)
          )
            return Response.json(
              { error: 'A WABA não foi concedida ao token atual.' },
              { status: 422 },
            )

          const [waba, phone] = await Promise.all([
            getWhatsAppBusinessAccount({
              wabaId: body.wabaId,
              accessToken: token.access_token,
            }),
            getWhatsAppPhoneNumber({
              wabaId: body.wabaId,
              phoneNumberId: body.phoneNumberId,
              accessToken: token.access_token,
            }),
          ])
          const now = new Date()
          const expiresAt = debug.data.expires_at
            ? new Date(debug.data.expires_at * 1_000).toISOString()
            : token.expires_in
              ? new Date(now.getTime() + token.expires_in * 1_000).toISOString()
              : null
          const { data: account, error: accountError } = await context.admin
            .from('whatsapp_accounts')
            .upsert(
              {
                workspace_id: context.workspaceId,
                waba_id: waba.id,
                phone_number_id: phone.id,
                business_id: body.businessId ?? null,
                display_phone_number: phone.display_phone_number ?? null,
                verified_name: phone.verified_name ?? waba.name ?? null,
                quality_rating: phone.quality_rating ?? null,
                status: 'pending',
                scopes,
                subscribed_fields: [],
                token_expires_at: expiresAt,
                connected_by: context.user.id,
                permissions_validated_at: now.toISOString(),
                connection_error: null,
              },
              { onConflict: 'workspace_id,phone_number_id' },
            )
            .select('id')
            .single()
          if (accountError) throw accountError
          accountId = account.id
          await saveIntegrationCredential({
            workspaceId: context.workspaceId,
            provider: 'meta',
            credentialType: 'access_token',
            scopeKey: account.id,
            whatsappAccountId: account.id,
            value: token.access_token,
            expiresAt,
            metadata: {
              channel: 'whatsapp',
              tokenType: token.token_type ?? 'bearer',
              scopes,
              metaUserId: debug.data.user_id ?? null,
              wabaId: body.wabaId,
            },
          })

          const subscription = await subscribeWhatsAppBusinessAccount({
            wabaId: body.wabaId,
            accessToken: token.access_token,
          })
          if (!subscription.success)
            throw new Error('A Meta não confirmou a assinatura da WABA.')
          const subscriptions = await getWhatsAppBusinessAccountSubscriptions({
            wabaId: body.wabaId,
            accessToken: token.access_token,
          })
          if (
            !whatsappSubscriptionsIncludeApp(
              subscriptions.data,
              env.META_APP_ID,
            )
          )
            throw new Error('Assinatura de webhook da WABA não foi confirmada.')
          const { error: activationError } = await context.admin
            .from('whatsapp_accounts')
            .update({
              status: 'connected',
              subscribed_fields: WHATSAPP_WEBHOOK_FIELDS,
              webhook_subscribed_at: now.toISOString(),
              last_sync_at: now.toISOString(),
              connection_error: null,
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', account.id)
          if (activationError) throw activationError
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'meta',
            action: 'whatsapp_embedded_signup_connected',
            status: 'success',
            resourceId: account.id,
            details: {
              wabaId: body.wabaId,
              phoneNumberId: body.phoneNumberId,
              scopes,
            },
          })
          return Response.json(
            {
              id: account.id,
              verifiedName: phone.verified_name ?? waba.name ?? null,
              displayPhoneNumber: phone.display_phone_number ?? null,
              status: 'connected',
            },
            { status: 201 },
          )
        } catch (error) {
          if (context && accountId) {
            await deleteIntegrationCredential({
              workspaceId: context.workspaceId,
              provider: 'meta',
              credentialType: 'access_token',
              scopeKey: accountId,
            }).catch(() => undefined)
            await context.admin
              .from('whatsapp_accounts')
              .update({
                status: 'disconnected',
                connection_error: 'embedded_signup_failed',
              })
              .eq('workspace_id', context.workspaceId)
              .eq('id', accountId)
            await writeIntegrationAudit({
              workspaceId: context.workspaceId,
              actorUserId: context.user.id,
              provider: 'meta',
              action: 'whatsapp_embedded_signup_connected',
              status: 'failure',
              resourceId: accountId,
            })
          }
          return apiErrorResponse(
            error,
            'Não foi possível concluir a conexão do WhatsApp.',
          )
        }
      },
    },
  },
})
