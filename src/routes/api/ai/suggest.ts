/** Contrato HTTP validado para sugestões do agente de IA. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { suggestInstagramReply } from '../../../server/ai.server'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { readJsonBody } from '../../../server/request-body.server'
import { assertRateLimit } from '../../../server/rate-limit.server'

// Limites explícitos reduzem custo, latência e exposição acidental de dados ao modelo.
const bodySchema = z
  .object({
    agentId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().trim().min(1).max(4_000),
        }),
      )
      .min(1)
      .max(5)
      .optional(),
  })
  .refine((body) => Boolean(body.conversationId) !== Boolean(body.history), {
    message: 'Informe conversationId ou history, mas não ambos.',
  })

export const Route = createFileRoute('/api/ai/suggest')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          await assertRateLimit({
            namespace: 'ai-suggest',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 20,
            windowSeconds: 60,
          })
          const parsed = bodySchema.parse(await readJsonBody(request))
          let history = parsed.history
          // Sem conversa não há contato, e as ferramentas de agenda ficam
          // restritas a consultar — que é o certo: não dá para remarcar a
          // reunião de alguém que não se sabe quem é.
          let contactId: string | null = null
          if (parsed.conversationId) {
            const { data: conversation, error: conversationError } =
              await context.supabase
                .from('conversations')
                .select('id,contact_id')
                .eq('workspace_id', context.workspaceId)
                .eq('id', parsed.conversationId)
                .maybeSingle()
            if (conversationError) throw conversationError
            contactId = conversation?.contact_id ?? null
            if (!conversation)
              return Response.json(
                { error: 'Conversa não encontrada.' },
                { status: 404 },
              )
            const { data: messages, error: messagesError } =
              await context.supabase
                .from('messages')
                .select('direction,body')
                .eq('workspace_id', context.workspaceId)
                .eq('conversation_id', conversation.id)
                .not('body', 'is', null)
                .order('created_at', { ascending: false })
                .limit(10)
            if (messagesError) throw messagesError
            history = messages.reverse().map((message) => ({
              role:
                message.direction === 'inbound'
                  ? ('user' as const)
                  : ('assistant' as const),
              content: String(message.body).slice(0, 4_000),
            }))
          } else if (context.role === 'agent') {
            return Response.json(
              { error: 'Agentes só podem sugerir a partir de uma conversa.' },
              { status: 403 },
            )
          }
          if (!history || history.length === 0)
            return Response.json(
              { error: 'A conversa ainda não possui mensagens de texto.' },
              { status: 422 },
            )
          const result = await suggestInstagramReply({
            workspaceId: context.workspaceId,
            agentId: parsed.agentId,
            history,
            safetyIdentifier: `${context.workspaceId}:${context.user.id}`,
            contactId,
          })
          return Response.json(
            {
              suggestion: result.suggestion,
              provider: result.provider,
              model: result.model,
              sources: result.sources,
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
