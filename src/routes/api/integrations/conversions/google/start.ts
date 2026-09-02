/** Inicia OAuth Google Ads reutilizando state/PKCE do Google Workspace. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../../server/api-auth.server'
import { hasValidCredentialEncryptionKey } from '../../../../../server/credentials-crypto.server'
import { getServerEnv } from '../../../../../server/env.server'
import {
  GOOGLE_ADS_SCOPES,
  buildGoogleAuthorizationUrl,
  createGoogleOAuthState,
  googleWorkspaceConfigured,
} from '../../../../../server/google-calendar.server'
import { assertRateLimit } from '../../../../../server/rate-limit.server'

function oauthCookie(name: string, value: string) {
  const secure = getServerEnv().APP_ORIGIN.startsWith('https://')
  return [
    `${secure ? '__Host-' : ''}${name}=${value}`,
    'HttpOnly',
    secure ? 'Secure' : '',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=600',
  ]
    .filter(Boolean)
    .join('; ')
}

export const Route = createFileRoute(
  '/api/integrations/conversions/google/start',
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
          await assertRateLimit({
            namespace: 'google-ads-oauth-start',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 5,
            windowSeconds: 600,
          })
          if (!googleWorkspaceConfigured())
            return Response.json(
              { error: 'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.' },
              { status: 503 },
            )
          if (!hasValidCredentialEncryptionKey())
            return Response.json(
              { error: 'Configure CREDENTIALS_ENCRYPTION_KEY antes do OAuth.' },
              { status: 503 },
            )
          const oauth = await createGoogleOAuthState({
            workspaceId: context.workspaceId,
            userId: context.user.id,
            redirectAfter: '/integracoes',
          })
          const headers = new Headers({ 'Cache-Control': 'no-store' })
          headers.append(
            'Set-Cookie',
            oauthCookie('wal_google_oauth_state', oauth.state),
          )
          headers.append(
            'Set-Cookie',
            oauthCookie('wal_google_pkce', oauth.verifier),
          )
          return Response.json(
            {
              authorizationUrl: buildGoogleAuthorizationUrl({
                state: oauth.state,
                challenge: oauth.challenge,
                scopes: GOOGLE_ADS_SCOPES,
              }),
            },
            { headers },
          )
        } catch (error) {
          return apiErrorResponse(
            error,
            'Não foi possível iniciar o Google Ads.',
          )
        }
      },
    },
  },
})
