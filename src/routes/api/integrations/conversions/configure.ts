/** Salva configuração OCI/CAPI sem devolver secrets. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { adConversionConfigurationSchema } from '../../../../server/ad-conversions-contract'
import { configureAdConversionConnection } from '../../../../server/ad-conversions.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

export const Route = createFileRoute('/api/integrations/conversions/configure')(
  {
    server: {
      handlers: {
        PUT: async ({ request }) => {
          try {
            assertTrustedOrigin(request)
            const context = await requireWorkspaceContext(request, [
              'owner',
              'admin',
            ])
            await assertRateLimit({
              namespace: 'ad-conversions-configure',
              identity: `${context.workspaceId}:${context.user.id}`,
              limit: 12,
              windowSeconds: 300,
            })
            const configuration = adConversionConfigurationSchema.parse(
              await readJsonBody(request),
            )
            return Response.json(
              await configureAdConversionConnection({
                workspaceId: context.workspaceId,
                actorUserId: context.user.id,
                configuration,
              }),
              { headers: { 'Cache-Control': 'no-store' } },
            )
          } catch (error) {
            return apiErrorResponse(
              error,
              'Falha ao salvar a integração de Ads.',
            )
          }
        },
      },
    },
  },
)
