/** Callback OAuth: troca o code, assina webhooks e salva o token cifrado. */
import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'
import { getServerEnv } from '../../../../server/env.server'
import {
  getMetaOwnProfile,
  consumeMetaOAuthState,
  exchangeMetaAuthorizationCode,
  getMetaWebhookSubscriptions,
  MetaApiError,
  META_REQUIRED_SCOPES,
  META_WEBHOOK_FIELDS,
  normalizeMetaAccountType,
  subscribeMetaWebhooks,
} from '../../../../server/meta-api.server'
import {
  deleteIntegrationCredential,
  saveIntegrationCredential,
  writeIntegrationAudit,
} from '../../../../server/integration-credentials.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { requestIdentity } from '../../../../server/request-identity.server'
import { getSupabaseAdmin } from '../../../../server/supabase-admin.server'

function readCookie(request: Request, name: string) {
  for (const item of request.headers.get('cookie')?.split(/;\s*/) ?? []) {
    const separator = item.indexOf('=')
    if (separator > 0 && item.slice(0, separator) === name)
      return item.slice(separator + 1)
  }
  return null
}

function equalState(left: string | null, right: string) {
  if (!left) return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

type MetaOAuthStage =
  | 'consume_state'
  | 'exchange_code'
  | 'fetch_profile'
  | 'upsert_account'
  | 'save_credential'
  | 'subscribe_webhooks'
  | 'fetch_subscriptions'
  | 'activate_account'
  | 'write_audit'

function callbackResponse(
  status: 'connected' | 'denied' | 'error',
  stage?: MetaOAuthStage,
) {
  const secure = getServerEnv().APP_ORIGIN.startsWith('https://')
  const cookieName = secure
    ? '__Host-wal_meta_oauth_state'
    : 'wal_meta_oauth_state'
  const target = new URL('/configuracoes', getServerEnv().APP_ORIGIN)
  target.searchParams.set('meta', status)
  // O estágio é um código interno fixo e seguro; respostas brutas da Meta nunca
  // retornam ao navegador nem são persistidas nos parâmetros da URL.
  if (status === 'error' && stage) target.searchParams.set('meta_stage', stage)
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': [
        `${cookieName}=`,
        'HttpOnly',
        secure ? 'Secure' : '',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=0',
      ]
        .filter(Boolean)
        .join('; '),
    },
  })
}

export const Route = createFileRoute('/api/integrations/meta/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Mesmo protegido pelo state de uso unico, o callback e anonimo e toca
        // o banco a cada chamada; a cota mantem o custo previsivel.
        try {
          await assertRateLimit({
            namespace: 'meta-oauth-callback',
            identity: requestIdentity(request),
            limit: 30,
            windowSeconds: 300,
          })
        } catch {
          return callbackResponse('error')
        }
        const url = new URL(request.url)
        if (url.searchParams.get('error')) return callbackResponse('denied')
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        if (!code || !state) return callbackResponse('error')
        const secure = getServerEnv().APP_ORIGIN.startsWith('https://')
        const cookieName = secure
          ? '__Host-wal_meta_oauth_state'
          : 'wal_meta_oauth_state'
        if (!equalState(readCookie(request, cookieName), state))
          return callbackResponse('error')

        let oauth: Awaited<ReturnType<typeof consumeMetaOAuthState>> | null =
          null
        let accountId: string | null = null
        let stage: MetaOAuthStage = 'consume_state'
        try {
          oauth = await consumeMetaOAuthState(state)
          stage = 'exchange_code'
          const token = await exchangeMetaAuthorizationCode(code)
          stage = 'fetch_profile'
          const profile = await getMetaOwnProfile(token.accessToken)
          const instagramUserId = String(
            profile.user_id ?? profile.id ?? token.userId,
          )
          const supabase = getSupabaseAdmin()
          if (!supabase)
            throw new Error('Supabase administrativo indisponível.')
          const now = new Date()
          const missingScopes = META_REQUIRED_SCOPES.filter(
            (scope) => !token.scopes.includes(scope),
          )
          const expiresAt = new Date(
            now.getTime() + token.expiresIn * 1_000,
          ).toISOString()
          const refreshAfter = new Date(
            now.getTime() +
              Math.min(token.expiresIn * 500, 30 * 24 * 60 * 60_000),
          ).toISOString()
          stage = 'upsert_account'
          const { data: account, error } = await supabase
            .from('instagram_accounts')
            .upsert(
              {
                workspace_id: oauth.workspace_id,
                instagram_user_id: instagramUserId,
                username: profile.username,
                display_name: profile.name ?? profile.username,
                profile_picture_url: profile.profile_picture_url ?? null,
                account_type: normalizeMetaAccountType(profile.account_type),
                connected_by: oauth.user_id,
                status: 'disconnected',
                scopes: token.scopes,
                subscribed_fields: [],
                token_expires_at: expiresAt,
                token_refresh_after: refreshAfter,
                last_token_refresh_at: now.toISOString(),
                permissions_validated_at: null,
                webhook_subscribed_at: null,
                last_sync_at: now.toISOString(),
                connection_error:
                  missingScopes.length > 0
                    ? `Permissões não confirmadas: ${missingScopes.join(', ')}`
                    : null,
              },
              { onConflict: 'workspace_id,instagram_user_id' },
            )
            .select('id')
            .single()
          if (error) throw error
          accountId = account.id
          stage = 'save_credential'
          await saveIntegrationCredential({
            workspaceId: oauth.workspace_id,
            provider: 'meta',
            credentialType: 'access_token',
            scopeKey: account.id,
            instagramAccountId: account.id,
            value: token.accessToken,
            expiresAt,
            metadata: { tokenType: token.tokenType, scopes: token.scopes },
          })
          stage = 'subscribe_webhooks'
          await subscribeMetaWebhooks({
            instagramUserId,
            accessToken: token.accessToken,
          })
          stage = 'fetch_subscriptions'
          const subscriptions = await getMetaWebhookSubscriptions({
            instagramUserId,
            accessToken: token.accessToken,
          })
          const subscribedFields = Array.from(
            new Set(
              (subscriptions.data ?? []).flatMap(
                (subscription) => subscription.subscribed_fields ?? [],
              ),
            ),
          )
          const missingWebhookFields = META_WEBHOOK_FIELDS.filter(
            (field) => !subscribedFields.includes(field),
          )
          const connectionIssues = [
            ...(missingScopes.length > 0
              ? [`Permissões não confirmadas: ${missingScopes.join(', ')}`]
              : []),
            ...(missingWebhookFields.length > 0
              ? [`Webhooks não confirmados: ${missingWebhookFields.join(', ')}`]
              : []),
          ]
          stage = 'activate_account'
          const { error: activateError } = await supabase
            .from('instagram_accounts')
            .update({
              status: 'connected',
              subscribed_fields: subscribedFields,
              permissions_validated_at:
                missingScopes.length === 0 ? now.toISOString() : null,
              webhook_subscribed_at:
                missingWebhookFields.length === 0 ? now.toISOString() : null,
              connection_error:
                connectionIssues.length > 0
                  ? connectionIssues.join(' | ')
                  : null,
            })
            .eq('id', account.id)
            .eq('workspace_id', oauth.workspace_id)
          if (activateError) throw activateError
          stage = 'write_audit'
          await writeIntegrationAudit({
            workspaceId: oauth.workspace_id,
            actorUserId: oauth.user_id,
            provider: 'meta',
            action: 'oauth_connected',
            status: 'success',
            resourceId: account.id,
            details: {
              username: profile.username,
              missingScopes,
              missingWebhookFields,
            },
          })
          return callbackResponse('connected')
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'meta_oauth_callback_failed',
              error: error instanceof Error ? error.name : 'unknown_error',
              stage,
              ...(error instanceof MetaApiError
                ? {
                    metaStatus: error.status,
                    metaCode: error.code,
                    metaSubcode: error.subcode,
                  }
                : {}),
            }),
          )
          if (oauth) {
            if (accountId) {
              await deleteIntegrationCredential({
                workspaceId: oauth.workspace_id,
                provider: 'meta',
                credentialType: 'access_token',
                scopeKey: accountId,
              }).catch(() => undefined)
              await getSupabaseAdmin()
                ?.from('instagram_accounts')
                .update({
                  status: 'disconnected',
                  connection_error: 'oauth_connection_failed',
                })
                .eq('id', accountId)
                .eq('workspace_id', oauth.workspace_id)
            }
            await writeIntegrationAudit({
              workspaceId: oauth.workspace_id,
              actorUserId: oauth.user_id,
              provider: 'meta',
              action: 'oauth_connected',
              status: 'failure',
              details: {
                stage,
                errorKind:
                  error instanceof MetaApiError
                    ? 'meta_api'
                    : error instanceof Error
                      ? error.name
                      : 'unknown_error',
                ...(error instanceof MetaApiError
                  ? {
                      metaStatus: error.status,
                      metaCode: error.code ?? null,
                      metaSubcode: error.subcode ?? null,
                    }
                  : {}),
              },
            })
          }
          return callbackResponse('error', stage)
        }
      },
    },
  },
})
