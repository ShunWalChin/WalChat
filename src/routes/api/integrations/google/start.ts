/** Inicia OAuth Google Workspace com state, PKCE e cookie HttpOnly. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { hasValidCredentialEncryptionKey } from '../../../../server/credentials-crypto.server'
import { getServerEnv } from '../../../../server/env.server'
import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthState,
  googleWorkspaceConfigured,
} from '../../../../server/google-calendar.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'

function oauthCookie(name: string, value: string, maxAge: number) {
  const secure = getServerEnv().APP_ORIGIN.startsWith('https://')
  const prefix = secure ? '__Host-' : ''
  return [
    `${prefix}${name}=${value}`,
    'HttpOnly',
    secure ? 'Secure' : '',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join('; ')
}

export const Route = createFileRoute('/api/integrations/google/start')({
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
            namespace: 'google-oauth-start',
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
          })
          const headers = new Headers({ 'Cache-Control': 'no-store' })
          headers.append(
            'Set-Cookie',
            oauthCookie('wal_google_oauth_state', oauth.state, 600),
          )
          headers.append(
            'Set-Cookie',
            oauthCookie('wal_google_pkce', oauth.verifier, 600),
          )
          return Response.json(
            {
              authorizationUrl: buildGoogleAuthorizationUrl({
                state: oauth.state,
                challenge: oauth.challenge,
              }),
            },
            { headers },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Não foi possível iniciar o Google.')
        }
      },
    },
  },
})
