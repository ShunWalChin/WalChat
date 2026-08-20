/** CRUD autenticado das personas usadas no copiloto e modo autônomo. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'

const agentFields = {
  name: z.string().trim().min(2).max(80),
  persona: z.string().trim().min(10).max(4_000),
  mode: z.enum(['copilot', 'autonomous']),
  tone: z.string().trim().min(2).max(120),
  isActive: z.boolean(),
  providerOverride: z.enum(['openai', 'google']).nullable().optional(),
  modelOverride: z.string().max(80).nullable().optional(),
  maxReplyChars: z.number().int().min(100).max(1_000),
  fallbackToCopilot: z.boolean(),
}
const createSchema = z.object(agentFields)
const updateSchema = z
  .object({ id: z.string().uuid(), ...agentFields })
  .partial()
  .required({ id: true })
const deleteSchema = z.object({ id: z.string().uuid() })

export const Route = createFileRoute('/api/ai/agents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [
            { data: agents, error },
            { data: documents, error: documentsError },
          ] = await Promise.all([
            context.supabase
              .from('ai_agents')
              .select('*')
              .eq('workspace_id', context.workspaceId)
              .order('created_at'),
            context.supabase
              .from('knowledge_documents')
              .select('ai_agent_id')
              .eq('workspace_id', context.workspaceId),
          ])
          if (error) throw error
          if (documentsError) throw documentsError
          const counts = new Map<string, number>()
          for (const document of documents)
            if (document.ai_agent_id)
              counts.set(
                document.ai_agent_id,
                (counts.get(document.ai_agent_id) ?? 0) + 1,
              )
          return Response.json({
            agents: agents.map((agent) => ({
              id: agent.id,
              name: agent.name,
              persona: agent.persona,
              mode: agent.mode,
              tone: agent.tone,
              isActive: agent.is_active,
              providerOverride: agent.provider_override,
              modelOverride: agent.model_override,
              maxReplyChars: agent.max_reply_chars,
              fallbackToCopilot: agent.fallback_to_copilot,
              knowledgeCount: counts.get(agent.id) ?? 0,
            })),
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar os agentes.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = createSchema.parse(await request.json())
          const { data, error } = await context.supabase
            .from('ai_agents')
            .insert({
              workspace_id: context.workspaceId,
              name: body.name,
              persona: body.persona,
              mode: body.mode,
              tone: body.tone,
              is_active: body.isActive,
              provider_override: body.providerOverride ?? null,
              model_override: body.modelOverride ?? null,
              max_reply_chars: body.maxReplyChars,
              fallback_to_copilot: body.fallbackToCopilot,
            })
            .select('id')
            .single()
          if (error) throw error
          return Response.json({ id: data.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar o agente.')
        }
      },
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = updateSchema.parse(await request.json())
          const changes: Record<string, unknown> = {}
          if (body.name !== undefined) changes.name = body.name
          if (body.persona !== undefined) changes.persona = body.persona
          if (body.mode !== undefined) changes.mode = body.mode
          if (body.tone !== undefined) changes.tone = body.tone
          if (body.isActive !== undefined) changes.is_active = body.isActive
          if (body.providerOverride !== undefined)
            changes.provider_override = body.providerOverride
          if (body.modelOverride !== undefined)
            changes.model_override = body.modelOverride
          if (body.maxReplyChars !== undefined)
            changes.max_reply_chars = body.maxReplyChars
          if (body.fallbackToCopilot !== undefined)
            changes.fallback_to_copilot = body.fallbackToCopilot
          const { data, error } = await context.supabase
            .from('ai_agents')
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data)
            return Response.json(
              { error: 'Agente não encontrado.' },
              { status: 404 },
            )
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o agente.')
        }
      },
      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = deleteSchema.parse(await request.json())
          const { error } = await context.supabase
            .from('ai_agents')
            .delete()
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
          if (error) throw error
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao excluir o agente.')
        }
      },
    },
  },
})
