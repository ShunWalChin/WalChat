/** Valida credenciais/configuração sem enviar conversão de negócio. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { adConversionTestSchema } from '../../../../server/ad-conversions-contract'
import { testAdConversionConnection } from '../../../../server/ad-conversions.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

export const Route = createFileRoute('/api/integrations/conversions/test')({
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
            namespace: 'ad-conversions-test',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 10,
            windowSeconds: 300,
          })
          const body = adConversionTestSchema.parse(await readJsonBody(request))
          return Response.json(
            await testAdConversionConnection({
              workspaceId: context.workspaceId,
              actorUserId: context.user.id,
              provider: body.provider,
            }),
          )
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao validar a integração de Ads.',
          )
        }
      },
    },
  },
})
