/** Desconecta um provedor e apaga as credenciais cifradas correspondentes. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { disconnectAdConversionConnection } from '../../../../server/ad-conversions.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'

const querySchema = z.enum(['google_ads', 'meta_capi'])

export const Route = createFileRoute(
  '/api/integrations/conversions/disconnect',
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
          await assertRateLimit({
            namespace: 'ad-conversions-disconnect',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 10,
            windowSeconds: 300,
          })
          const provider = querySchema.parse(
            new URL(request.url).searchParams.get('provider'),
          )
          await disconnectAdConversionConnection({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider,
          })
          return Response.json({ disconnected: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao desconectar a integração.')
        }
      },
    },
  },
})
