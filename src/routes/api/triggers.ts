/** CRUD dos gatilhos simples usados pelo worker de webhooks. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { readJsonBody } from '../../server/request-body.server'

const fields = {
  name: z.string().trim().min(2).max(100),
  source: z.enum(['comment', 'dm', 'story', 'whatsapp']),
  keyword: z.string().trim().min(1).max(100),
  matchMode: z.enum(['exact', 'contains']),
  responseText: z.string().trim().min(1).max(1_000),
  postId: z.string().uuid().nullable().optional(),
  cooldownHours: z.number().int().min(24).max(168),
  isActive: z.boolean(),
  bookingPageId: z.uuid().nullable().optional(),
}
const createSchema = z.object(fields)
const updateSchema = z
  .object({ id: z.string().uuid(), ...fields })
  .partial()
  .required({ id: true })
const deleteSchema = z.object({ id: z.string().uuid() })

async function bookingPageBelongs(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
  bookingPageId: string | null | undefined,
) {
  if (!bookingPageId) return true
  const { count, error } = await context.supabase
    .from('booking_pages')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', context.workspaceId)
    .eq('id', bookingPageId)
    .eq('is_active', true)
  if (error) throw error
  return Boolean(count)
}

export const Route = createFileRoute('/api/triggers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [
            { data: triggers, error },
            { data: cooldowns, error: cooldownsError },
            { data: runs, error: runsError },
            { data: bookingPages, error: bookingPagesError },
          ] = await Promise.all([
            context.supabase
              .from('triggers')
              .select(
                'id,name,source,keyword,match_mode,response_text,post_id,cooldown_hours,is_active,booking_page_id,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at'),
            context.supabase
              .from('trigger_cooldowns')
              .select('trigger_id')
              .eq('workspace_id', context.workspaceId),
            context.supabase
              .from('automation_runs')
              .select('trigger_id,status')
              .eq('workspace_id', context.workspaceId),
            context.supabase
              .from('booking_pages')
              .select('id,title,slug')
              .eq('workspace_id', context.workspaceId)
              .eq('is_active', true)
              .order('title'),
          ])
          if (error) throw error
          if (cooldownsError) throw cooldownsError
          if (runsError) throw runsError
          if (bookingPagesError) throw bookingPagesError
          const counts = new Map<string, number>()
          for (const item of cooldowns)
            counts.set(item.trigger_id, (counts.get(item.trigger_id) ?? 0) + 1)
          const runCounts = new Map<string, { sent: number; failed: number }>()
          for (const run of runs) {
            const current = runCounts.get(run.trigger_id) ?? {
              sent: 0,
              failed: 0,
            }
            if (run.status === 'sent') current.sent++
            if (run.status === 'failed' || run.status === 'blocked')
              current.failed++
            runCounts.set(run.trigger_id, current)
          }
          return Response.json({
            triggers: triggers.map((trigger) => ({
              id: trigger.id,
              name: trigger.name,
              source: trigger.source,
              keyword: trigger.keyword,
              matchMode: trigger.match_mode,
              responseText: trigger.response_text,
              postId: trigger.post_id,
              cooldownHours: trigger.cooldown_hours,
              isActive: trigger.is_active,
              bookingPageId: trigger.booking_page_id,
              fired: counts.get(trigger.id) ?? 0,
              sent: runCounts.get(trigger.id)?.sent ?? 0,
              failed: runCounts.get(trigger.id)?.failed ?? 0,
            })),
            bookingPages,
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
          const body = createSchema.parse(await readJsonBody(request))
          if (!(await bookingPageBelongs(context, body.bookingPageId)))
            return Response.json(
              { error: 'Agenda não pertence ao workspace.' },
              { status: 422 },
            )
          if (body.postId) {
            const { data: post, error: postError } = await context.supabase
              .from('posts_cache')
              .select('id')
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.postId)
              .maybeSingle()
            if (postError) throw postError
            if (!post)
              return Response.json(
                { error: 'Post não pertence ao workspace.' },
                { status: 422 },
              )
          }
          const { data, error } = await context.supabase
            .from('triggers')
            .insert({
              workspace_id: context.workspaceId,
              name: body.name,
              source: body.source,
              keyword: body.keyword,
              match_mode: body.matchMode,
              response_text: body.responseText,
              post_id: body.postId ?? null,
              cooldown_hours: body.cooldownHours,
              is_active: body.isActive,
              booking_page_id: body.bookingPageId ?? null,
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
          const body = updateSchema.parse(await readJsonBody(request))
          if (!(await bookingPageBelongs(context, body.bookingPageId)))
            return Response.json(
              { error: 'Agenda não pertence ao workspace.' },
              { status: 422 },
            )
          if (body.postId) {
            const { data: post, error: postError } = await context.supabase
              .from('posts_cache')
              .select('id')
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.postId)
              .maybeSingle()
            if (postError) throw postError
            if (!post)
              return Response.json(
                { error: 'Post não pertence ao workspace.' },
                { status: 422 },
              )
          }
          const changes: Record<string, unknown> = {}
          if (body.name !== undefined) changes.name = body.name
          if (body.source !== undefined) changes.source = body.source
          if (body.keyword !== undefined) changes.keyword = body.keyword
          if (body.matchMode !== undefined) changes.match_mode = body.matchMode
          if (body.responseText !== undefined)
            changes.response_text = body.responseText
          if (body.postId !== undefined) changes.post_id = body.postId
          if (body.cooldownHours !== undefined)
            changes.cooldown_hours = body.cooldownHours
          if (body.isActive !== undefined) changes.is_active = body.isActive
          if (body.bookingPageId !== undefined)
            changes.booking_page_id = body.bookingPageId
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
          const body = deleteSchema.parse(await readJsonBody(request))
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
