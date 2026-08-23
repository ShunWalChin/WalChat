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
  postId: z.string().uuid().nullable().optional(),
  cooldownHours: z.number().int().min(24).max(168),
  isActive: z.boolean(),
  bookingPageId: z.uuid().nullable().optional(),
}
const destinationFields = {
  responseText: z.string().trim().min(1).max(1_000).nullable().optional(),
  sequenceId: z.uuid().nullable().optional(),
  flowId: z.uuid().nullable().optional(),
}
const triggerInputSchema = z
  .object({ ...fields, ...destinationFields })
  .strict()
const createSchema = triggerInputSchema.superRefine((value, context) => {
  if (
    [value.responseText, value.sequenceId, value.flowId].filter(Boolean)
      .length !== 1
  )
    context.addIssue({
      code: 'custom',
      path: ['responseText'],
      message: 'Escolha exatamente uma resposta, sequência ou automação.',
    })
})
const updateSchema = triggerInputSchema.partial().extend({ id: z.uuid() })
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

async function destinationBelongs(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
  destination: { sequenceId?: string | null; flowId?: string | null },
) {
  if (destination.sequenceId) {
    const { count, error } = await context.supabase
      .from('sequences')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', context.workspaceId)
      .eq('id', destination.sequenceId)
      .eq('is_active', true)
    if (error) throw error
    if (!count) return false
  }
  if (destination.flowId) {
    const { count, error } = await context.supabase
      .from('automation_flows')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', context.workspaceId)
      .eq('id', destination.flowId)
      .eq('status', 'published')
    if (error) throw error
    if (!count) return false
  }
  return true
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
            { data: flows, error: flowsError },
            { data: sequences, error: sequencesError },
          ] = await Promise.all([
            context.supabase
              .from('triggers')
              .select(
                'id,name,source,keyword,match_mode,response_text,sequence_id,flow_id,post_id,cooldown_hours,is_active,booking_page_id,created_at',
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
            context.supabase
              .from('automation_flows')
              .select('id,name,current_version')
              .eq('workspace_id', context.workspaceId)
              .eq('status', 'published')
              .order('name'),
            context.supabase
              .from('sequences')
              .select('id,name')
              .eq('workspace_id', context.workspaceId)
              .eq('is_active', true)
              .order('name'),
          ])
          if (error) throw error
          if (cooldownsError) throw cooldownsError
          if (runsError) throw runsError
          if (bookingPagesError) throw bookingPagesError
          if (flowsError) throw flowsError
          if (sequencesError) throw sequencesError
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
              sequenceId: trigger.sequence_id,
              flowId: trigger.flow_id,
              postId: trigger.post_id,
              cooldownHours: trigger.cooldown_hours,
              isActive: trigger.is_active,
              bookingPageId: trigger.booking_page_id,
              fired: counts.get(trigger.id) ?? 0,
              sent: runCounts.get(trigger.id)?.sent ?? 0,
              failed: runCounts.get(trigger.id)?.failed ?? 0,
            })),
            bookingPages,
            flows,
            sequences,
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
          if (!(await destinationBelongs(context, body)))
            return Response.json(
              { error: 'Destino não pertence ao workspace ou não está ativo.' },
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
              response_text: body.responseText ?? null,
              sequence_id: body.sequenceId ?? null,
              flow_id: body.flowId ?? null,
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
          const { data: current, error: currentError } = await context.supabase
            .from('triggers')
            .select('response_text,sequence_id,flow_id')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .maybeSingle()
          if (currentError) throw currentError
          if (!current)
            return Response.json(
              { error: 'Gatilho não encontrado.' },
              { status: 404 },
            )
          const destination = {
            responseText:
              body.responseText !== undefined
                ? body.responseText
                : current.response_text,
            sequenceId:
              body.sequenceId !== undefined
                ? body.sequenceId
                : current.sequence_id,
            flowId: body.flowId !== undefined ? body.flowId : current.flow_id,
          }
          if (
            [
              destination.responseText,
              destination.sequenceId,
              destination.flowId,
            ].filter(Boolean).length !== 1
          )
            return Response.json(
              {
                error:
                  'Escolha exatamente uma resposta, sequência ou automação.',
              },
              { status: 422 },
            )
          if (!(await destinationBelongs(context, destination)))
            return Response.json(
              { error: 'Destino não pertence ao workspace ou não está ativo.' },
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
          if (body.sequenceId !== undefined)
            changes.sequence_id = body.sequenceId
          if (body.flowId !== undefined) changes.flow_id = body.flowId
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
