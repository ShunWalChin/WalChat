/** Disparo manual auditável: o worker ainda aplica toda a política de compliance. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { startAutomationExecution } from '../../../../server/automation-engine.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

const flowIdSchema = z.uuid()
const executeSchema = z
  .object({
    contactId: z.uuid(),
    requestKey: z.string().regex(/^[A-Za-z0-9:_-]{16,100}$/),
  })
  .strict()

export const Route = createFileRoute('/api/automations/$flowId/execute')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          await assertRateLimit({
            namespace: 'automation-manual-execute',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 20,
            windowSeconds: 60,
          })
          const flowId = flowIdSchema.parse(params.flowId)
          const body = executeSchema.parse(await readJsonBody(request))
          const { data: contact, error } = await context.supabase
            .from('contacts')
            .select('id,platform,instagram_user_id,whatsapp_user_id')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.contactId)
            .is('archived_at', null)
            .maybeSingle()
          if (error) throw error
          if (!contact) throw new ApiError(404, 'Contato não encontrado.')
          const platform =
            contact.platform === 'whatsapp' ? 'whatsapp' : 'instagram'
          if (
            (platform === 'instagram' && !contact.instagram_user_id) ||
            (platform === 'whatsapp' && !contact.whatsapp_user_id)
          )
            throw new ApiError(
              422,
              'O contato não possui um identificador de mensageria válido.',
            )
          const execution = await startAutomationExecution(
            {
              workspaceId: context.workspaceId,
              flowId,
              contactId: contact.id,
              platform,
              idempotencyKey: `manual:${context.user.id}:${body.requestKey}`,
              context: {
                source: 'manual',
                actorUserId: context.user.id,
              },
            },
            context.admin,
          )
          return Response.json(execution, {
            status: execution.duplicate ? 200 : 202,
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao iniciar a automação.')
        }
      },
    },
  },
})
