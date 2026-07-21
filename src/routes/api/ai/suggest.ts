/** Contrato HTTP validado para sugestões do agente de IA. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { suggestInstagramReply } from '../../../server/ai.server'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'

// Limites explícitos reduzem custo, latência e exposição acidental de dados ao modelo.
const bodySchema = z.object({
  agentId: z.string().uuid(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4_000),
      }),
    )
    .min(1)
    .max(5),
})

export const Route = createFileRoute('/api/ai/suggest')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request)
          const parsed = bodySchema.parse(await request.json())
          const result = await suggestInstagramReply({
            workspaceId: context.workspaceId,
            agentId: parsed.agentId,
            history: parsed.history,
            safetyIdentifier: `${context.workspaceId}:${context.user.id}`,
          })
          return Response.json(
            {
              suggestion: result.suggestion,
              provider: result.provider,
              model: result.model,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Não foi possível gerar a sugestão.')
        }
      },
    },
  },
})
