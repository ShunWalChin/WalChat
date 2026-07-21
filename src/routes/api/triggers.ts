/** CRUD dos gatilhos simples usados pelo worker de webhooks. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'

const fields = {
  name: z.string().trim().min(2).max(100),
  source: z.enum(['comment', 'dm', 'story']),
  keyword: z.string().trim().min(1).max(100),
  matchMode: z.enum(['exact', 'contains']),
  responseText: z.string().trim().min(1).max(1_000),
  cooldownHours: z.number().int().min(24).max(168),
  isActive: z.boolean(),
}
const createSchema = z.object(fields)
const updateSchema = z
  .object({ id: z.string().uuid(), ...fields })
  .partial()
  .required({ id: true })
const deleteSchema = z.object({ id: z.string().uuid() })

export const Route = createFileRoute('/api/triggers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [
            { data: triggers, error },
            { data: cooldowns, error: cooldownsError },
          ] = await Promise.all([
            context.supabase
              .from('triggers')
              .select(
                'id,name,source,keyword,match_mode,response_text,cooldown_hours,is_active,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at'),
            context.supabase
              .from('trigger_cooldowns')
              .select('trigger_id')
              .eq('workspace_id', context.workspaceId),
          ])
          if (error) throw error
          if (cooldownsError) throw cooldownsError
          const counts = new Map<string, number>()
          for (const item of cooldowns)
            counts.set(item.trigger_id, (counts.get(item.trigger_id) ?? 0) + 1)
          return Response.json({
            triggers: triggers.map((trigger) => ({
              id: trigger.id,
              name: trigger.name,
              source: trigger.source,
              keyword: trigger.keyword,
              matchMode: trigger.match_mode,
              responseText: trigger.response_text,
              cooldownHours: trigger.cooldown_hours,
              isActive: trigger.is_active,
              fired: counts.get(trigger.id) ?? 0,
            })),
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar gatilhos.')
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
            .from('triggers')
            .insert({
              workspace_id: context.workspaceId,
              name: body.name,
              source: body.source,
              keyword: body.keyword,
              match_mode: body.matchMode,
              response_text: body.responseText,
              cooldown_hours: body.cooldownHours,
              is_active: body.isActive,
            })
            .select('id')
            .single()
          if (error) throw error
          return Response.json({ id: data.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar o gatilho.')
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
          if (body.source !== undefined) changes.source = body.source
          if (body.keyword !== undefined) changes.keyword = body.keyword
          if (body.matchMode !== undefined) changes.match_mode = body.matchMode
          if (body.responseText !== undefined)
            changes.response_text = body.responseText
          if (body.cooldownHours !== undefined)
            changes.cooldown_hours = body.cooldownHours
          if (body.isActive !== undefined) changes.is_active = body.isActive
          const { data, error } = await context.supabase
            .from('triggers')
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data)
            return Response.json(
              { error: 'Gatilho não encontrado.' },
              { status: 404 },
            )
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o gatilho.')
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
            .from('triggers')
            .delete()
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
          if (error) throw error
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao excluir o gatilho.')
        }
      },
    },
  },
})
