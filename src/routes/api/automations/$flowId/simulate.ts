/** Percorre o rascunho do fluxo sem enviar nada e sem tocar em serviço externo. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { validateAutomationGraph } from '../../../../server/automation-graph'
import { simulateAutomation } from '../../../../server/automation-simulator'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

const bodySchema = z
  .object({
    /** Grafo em edição; permite testar antes de salvar. */
    graph: z.unknown().optional(),
    replies: z.array(z.string().trim().max(1_000)).max(20).default([]),
    contact: z.record(z.string(), z.unknown()).optional(),
    seed: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict()

/** Contato fictício com os campos que um fluxo costuma usar em template. */
const DEMO_CONTACT = {
  id: '00000000-0000-4000-8000-000000000000',
  display_name: 'Contato de teste',
  full_name: 'Contato de Teste',
  username: 'contato_teste',
  email: 'contato@exemplo.com.br',
  phone: '5511999998888',
  lead_score: 60,
  lifecycle_stage: 'lead',
}

export const Route = createFileRoute('/api/automations/$flowId/simulate')({
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
            namespace: 'automation-simulate',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 60,
            windowSeconds: 60,
          })
          const body = bodySchema.parse(await readJsonBody(request))

          // Sem grafo no corpo, simula a versão em rascunho já salva.
          let source = body.graph
          if (source === undefined) {
            const { data: flow, error } = await context.supabase
              .from('automation_flows')
              .select('draft_graph')
              .eq('workspace_id', context.workspaceId)
              .eq('id', params.flowId)
              .maybeSingle()
            if (error) throw error
            if (!flow) throw new ApiError(404, 'Jornada não encontrada.')
            source = flow.draft_graph
          }

          // A mesma validação da publicação: simular um grafo inválido daria
          // uma confiança que a publicação depois desmentiria.
          const graph = validateAutomationGraph(source)

          const { data: botFields, error: botError } = await context.supabase
            .from('automation_bot_fields')
            .select('field_key,value')
            .eq('workspace_id', context.workspaceId)
            .eq('is_active', true)
          if (botError) throw botError

          const contact: Record<string, unknown> = {
            ...DEMO_CONTACT,
            ...(body.contact ?? {}),
          }
          const result = simulateAutomation({
            graph,
            variables: {
              contact,
              custom:
                (contact.custom_fields as
                  Record<string, unknown> | undefined) ?? {},
              bot: Object.fromEntries(
                botFields.map((field) => [field.field_key, field.value]),
              ),
              context: { simulated: true },
            },
            replies: body.replies,
            seed: body.seed,
          })

          return Response.json(result, {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Não foi possível simular a jornada.')
        }
      },
    },
  },
})
