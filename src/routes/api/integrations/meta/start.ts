/** Inicia o OAuth da Meta após autenticar o usuário e seu papel no tenant. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import {
  buildMetaAuthorizationUrl,
  createMetaOAuthState,
} from '../../../../server/meta-api.server'
import { getServerEnv } from '../../../../server/env.server'
import { hasValidCredentialEncryptionKey } from '../../../../server/credentials-crypto.server'

export const Route = createFileRoute('/api/integrations/meta/start')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          if (!hasValidCredentialEncryptionKey())
            return Response.json(
              {
                error:
                  'Configure CREDENTIALS_ENCRYPTION_KEY com 32 bytes em base64 ou hexadecimal.',
              },
              { status: 503 },
            )
          const { state } = await createMetaOAuthState({
            workspaceId: context.workspaceId,
            userId: context.user.id,
          })
          const secure = getServerEnv().APP_ORIGIN.startsWith('https://')
          return Response.json(
            { authorizationUrl: buildMetaAuthorizationUrl(state) },
            {
              headers: {
                'Cache-Control': 'no-store',
                'Set-Cookie': [
                  `wal_meta_oauth_state=${state}`,
                  'HttpOnly',
                  secure ? 'Secure' : '',
                  'SameSite=Lax',
                  'Path=/',
                  'Max-Age=600',
                ]
                  .filter(Boolean)
                  .join('; '),
              },
            },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Não foi possível iniciar a conexão.')
        }
      },
    },
  },
})
