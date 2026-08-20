/** Registra o telefone na Cloud API sem persistir o PIN de seis dígitos. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../../server/api-auth.server'
import {
  getWhatsAppAccountAccess,
  writeIntegrationAudit,
} from '../../../../../server/integration-credentials.server'
import { assertRateLimit } from '../../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../../server/request-body.server'
import { registerWhatsAppPhoneNumber } from '../../../../../server/whatsapp-api.server'

const schema = z.object({
  accountId: z.string().uuid(),
  pin: z.string().regex(/^[0-9]{6}$/),
})

export const Route = createFileRoute(
  '/api/integrations/meta/whatsapp/register',
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
            namespace: 'whatsapp-phone-register',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 3,
            windowSeconds: 600,
          })
          const body = schema.parse(await readJsonBody(request))
          const account = await getWhatsAppAccountAccess({
            workspaceId: context.workspaceId,
            whatsappAccountId: body.accountId,
          })
          const result = await registerWhatsAppPhoneNumber({
            phoneNumberId: account.phoneNumberId,
            accessToken: account.accessToken,
            pin: body.pin,
          })
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'meta',
            action: 'whatsapp_phone_registered',
            status: 'success',
            resourceId: body.accountId,
          })
          return Response.json({ registered: Boolean(result.success) })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Não foi possível registrar o telefone.',
          )
        }
      },
    },
  },
})
