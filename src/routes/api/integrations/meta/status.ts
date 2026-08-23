/** Estado sanitizado da integração Meta para a tela de configurações. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import {
  getInstagramAppConfig,
  getServerEnv,
  getWhatsAppAppConfig,
} from '../../../../server/env.server'
import { hasValidCredentialEncryptionKey } from '../../../../server/credentials-crypto.server'
import {
  META_REQUIRED_SCOPES,
  META_WEBHOOK_FIELDS,
} from '../../../../server/meta-api.server'
import {
  WHATSAPP_REQUIRED_SCOPES,
  WHATSAPP_WEBHOOK_FIELDS,
} from '../../../../server/whatsapp-api.server'

export const Route = createFileRoute('/api/integrations/meta/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const { data: accounts, error } = await context.supabase
            .from('instagram_accounts')
            .select(
              'id,instagram_user_id,username,display_name,profile_picture_url,account_type,status,scopes,subscribed_fields,token_expires_at,webhook_subscribed_at,permissions_validated_at,last_sync_at,connection_error',
            )
            .eq('workspace_id', context.workspaceId)
            .order('created_at')
          if (error) throw error
          const [
            { data: credentials, error: credentialsError },
            { data: whatsappAccounts, error: whatsappError },
          ] = await Promise.all([
            context.admin
              .from('integration_credentials')
              .select('scope_key,expires_at')
              .eq('workspace_id', context.workspaceId)
              .eq('provider', 'meta')
              .eq('credential_type', 'access_token'),
            context.supabase
              .from('whatsapp_accounts')
              .select(
                'id,waba_id,phone_number_id,display_phone_number,verified_name,quality_rating,status,scopes,subscribed_fields,token_expires_at,webhook_subscribed_at,permissions_validated_at,last_sync_at,connection_error',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at'),
          ])
          if (credentialsError) throw credentialsError
          if (whatsappError) throw whatsappError
          const credentialMap = new Map(
            credentials.map((item) => [item.scope_key, item.expires_at]),
          )
          const env = getServerEnv()
          const instagramApp = getInstagramAppConfig(env)
          const whatsappApp = getWhatsAppAppConfig(env)
          return Response.json(
            {
              platformConfigured: Boolean(
                instagramApp.appId &&
                instagramApp.appSecret &&
                instagramApp.verifyToken &&
                hasValidCredentialEncryptionKey(),
              ),
              liveMode: env.DEMO_MODE === 'false',
              graphVersion: env.META_GRAPH_VERSION,
              callbackUrl: `${env.APP_ORIGIN}/api/public/webhooks/instagram`,
              oauthRedirectUrl:
                env.META_OAUTH_REDIRECT_URI ??
                `${env.APP_ORIGIN}/api/integrations/meta/callback`,
              requiredScopes: META_REQUIRED_SCOPES,
              webhookFields: META_WEBHOOK_FIELDS,
              accounts: accounts.map((account) => ({
                ...account,
                tokenStored: credentialMap.has(account.id),
                tokenExpiresAt:
                  credentialMap.get(account.id) ?? account.token_expires_at,
              })),
              whatsapp: {
                embeddedSignupConfigured: Boolean(
                  whatsappApp.appId &&
                  whatsappApp.appSecret &&
                  whatsappApp.verifyToken &&
                  env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID &&
                  hasValidCredentialEncryptionKey(),
                ),
                appId: whatsappApp.appId ?? null,
                configurationId:
                  env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ?? null,
                callbackUrl: `${env.APP_ORIGIN}/api/public/webhooks/whatsapp`,
                requiredScopes: WHATSAPP_REQUIRED_SCOPES,
                webhookFields: WHATSAPP_WEBHOOK_FIELDS,
                accounts: whatsappAccounts.map((account) => ({
                  ...account,
                  tokenStored: credentialMap.has(account.id),
                  tokenExpiresAt:
                    credentialMap.get(account.id) ?? account.token_expires_at,
                })),
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Não foi possível consultar a Meta.')
        }
      },
    },
  },
})
