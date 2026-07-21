/** Contrato HTTP validado para sugestões do agente de IA. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { suggestInstagramReply } from '../../../server/ai.server'

// Limites explícitos reduzem custo, latência e exposição acidental de dados ao modelo.
const bodySchema = z.object({
  agentName: z.string().max(80).optional(),
  persona: z.string().max(4_000).optional(),
  knowledge: z.string().max(30_000).optional(),
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
        const parsed = bodySchema.safeParse(
          await request.json().catch(() => null),
        )
        if (!parsed.success)
          return Response.json({ error: 'Entrada inválida.' }, { status: 400 })
        try {
          const suggestion = await suggestInstagramReply(parsed.data)
          return Response.json(
            { suggestion },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          console.error('ai_suggestion_failed', error)
          return Response.json(
            { error: 'Não foi possível gerar a sugestão.' },
            { status: 502 },
          )
        }
      },
    },
  },
})
