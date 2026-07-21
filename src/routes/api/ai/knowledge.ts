/** CRUD da base textual de conhecimento, sempre limitada ao workspace. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'

const createSchema = z.object({
  agentId: z.string().uuid().nullable(),
  title: z.string().trim().min(2).max(120),
  content: z.string().trim().min(10).max(50_000),
})
const updateSchema = createSchema.partial().extend({ id: z.string().uuid() })
const deleteSchema = z.object({ id: z.string().uuid() })

async function assertAgentInWorkspace(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>['supabase'],
  workspaceId: string,
  agentId: string | null | undefined,
) {
  if (!agentId) return
  const { data, error } = await supabase
    .from('ai_agents')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('id', agentId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('O agente informado não pertence ao workspace.')
}

export const Route = createFileRoute('/api/ai/knowledge')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const agentId = new URL(request.url).searchParams.get('agentId')
          let query = context.supabase
            .from('knowledge_documents')
            .select('id,ai_agent_id,title,content,updated_at')
            .eq('workspace_id', context.workspaceId)
            .order('updated_at', { ascending: false })
          if (agentId) query = query.eq('ai_agent_id', agentId)
          const { data, error } = await query
          if (error) throw error
          return Response.json({ documents: data })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao consultar a base de conhecimento.',
          )
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
          await assertAgentInWorkspace(
            context.supabase,
            context.workspaceId,
            body.agentId,
          )
          const { data, error } = await context.supabase
            .from('knowledge_documents')
            .insert({
              workspace_id: context.workspaceId,
              ai_agent_id: body.agentId,
              title: body.title,
              content: body.content,
            })
            .select('id')
            .single()
          if (error) throw error
          return Response.json({ id: data.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar o documento.')
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
          await assertAgentInWorkspace(
            context.supabase,
            context.workspaceId,
            body.agentId,
          )
          const changes: Record<string, unknown> = {}
          if (body.agentId !== undefined) changes.ai_agent_id = body.agentId
          if (body.title !== undefined) changes.title = body.title
          if (body.content !== undefined) changes.content = body.content
          const { error } = await context.supabase
            .from('knowledge_documents')
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
          if (error) throw error
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o documento.')
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
            .from('knowledge_documents')
            .delete()
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
          if (error) throw error
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao excluir o documento.')
        }
      },
    },
  },
})
