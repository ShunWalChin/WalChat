/** CRUD das regras que transformam etapas do funil em conversões. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { adConversionRuleMutationSchema } from '../../../../server/ad-conversions-contract'
import { saveAdConversionRule } from '../../../../server/ad-conversions.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

export const Route = createFileRoute('/api/integrations/conversions/rules')({
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
            namespace: 'ad-conversions-rules',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 30,
            windowSeconds: 300,
          })
          const mutation = adConversionRuleMutationSchema.parse(
            await readJsonBody(request),
          )
          if (mutation.operation === 'delete') {
            const { error } = await context.admin
              .from('ad_conversion_rules')
              .delete()
              .eq('id', mutation.ruleId)
              .eq('workspace_id', context.workspaceId)
            if (error) throw error
            return Response.json({ deleted: true })
          }
          const saved = await saveAdConversionRule({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            rule: mutation.rule,
          })
          return Response.json({ ruleId: saved.id })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao salvar a regra de conversão.',
          )
        }
      },
    },
  },
})
