/** Agenda operacional unificada e CRUD de eventos/tarefas locais ou Google. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import {
  deleteGoogleEvent,
  deleteGoogleTask,
  upsertGoogleEvent,
  upsertGoogleTask,
} from '../../server/google-calendar.server'
import { readJsonBody } from '../../server/request-body.server'

const rangeSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
})

const attendeeSchema = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().max(120).optional(),
})

const eventFields = {
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(8000).nullable().optional(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  allDay: z.boolean().default(false),
  timezone: z.string().trim().min(1).max(80).default('America/Sao_Paulo'),
  eventType: z
    .enum(['event', 'meeting', 'content', 'campaign', 'sequence', 'booking'])
    .default('event'),
  location: z.string().trim().max(500).nullable().optional(),
  contactId: z.uuid().nullable().optional(),
  attendees: z.array(attendeeSchema).max(50).default([]),
  createMeet: z.boolean().default(false),
  syncGoogle: z.boolean().default(false),
  connectionId: z.uuid().nullable().optional(),
}

const createEventSchema = z
  .object({ entity: z.literal('event'), ...eventFields })
  .refine((value) => new Date(value.endAt) > new Date(value.startAt), {
    message: 'O término precisa ser posterior ao início.',
    path: ['endAt'],
  })
  .refine((value) => !value.createMeet || value.syncGoogle, {
    message: 'Google deve estar ativo para criar um Meet.',
    path: ['createMeet'],
  })

const taskFields = {
  title: z.string().trim().min(1).max(180),
  notes: z.string().trim().max(8000).nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  status: z
    .enum(['needs_action', 'in_progress', 'completed', 'cancelled'])
    .default('needs_action'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  contactId: z.uuid().nullable().optional(),
  assignedTo: z.uuid().nullable().optional(),
  syncGoogle: z.boolean().default(false),
  connectionId: z.uuid().nullable().optional(),
}

const createTaskSchema = z.object({ entity: z.literal('task'), ...taskFields })
const createSchema = z.discriminatedUnion('entity', [
  createEventSchema,
  createTaskSchema,
])

const updateEventSchema = z
  .object({ entity: z.literal('event'), id: z.uuid(), ...eventFields })
  .partial()
  .required({ entity: true, id: true })
const updateTaskSchema = z
  .object({ entity: z.literal('task'), id: z.uuid(), ...taskFields })
  .partial()
  .required({ entity: true, id: true })
const updateSchema = z.discriminatedUnion('entity', [
  updateEventSchema,
  updateTaskSchema,
])
const deleteSchema = z.object({
  entity: z.enum(['event', 'task']),
  id: z.uuid(),
})

type AdminClient = Awaited<ReturnType<typeof requireWorkspaceContext>>['admin']

async function assertOwnedReference(input: {
  admin: AdminClient
  workspaceId: string
  table: 'contacts' | 'calendar_connections'
  id?: string | null
}) {
  if (!input.id) return
  const { data, error } = await input.admin
    .from(input.table)
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.id)
    .maybeSingle()
  if (error) throw error
  if (!data)
    throw new ApiError(
      422,
      input.table === 'contacts'
        ? 'Contato não pertence ao workspace.'
        : 'Conexão Google não pertence ao workspace.',
    )
}

async function activity(input: {
  admin: AdminClient
  workspaceId: string
  actorUserId: string
  sourceType: string
  sourceId: string
  action: string
  title: string
  happenedAt?: string
  contactId?: string | null
}) {
  const { error } = await input.admin.from('calendar_activities').insert({
    workspace_id: input.workspaceId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    action: input.action,
    title: input.title,
    happened_at: input.happenedAt ?? new Date().toISOString(),
    contact_id: input.contactId ?? null,
    actor_user_id: input.actorUserId,
  })
  if (error) throw error
}

function eventMeetUrl(result: {
  hangoutLink?: string
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>
  }
}) {
  return (
    result.hangoutLink ??
    result.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === 'video',
    )?.uri ??
    null
  )
}

export const Route = createFileRoute('/api/calendar')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const url = new URL(request.url)
          const range = rangeSchema.parse({
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to'),
          })
          const span =
            new Date(range.to).getTime() - new Date(range.from).getTime()
          if (span <= 0 || span > 93 * 86_400_000)
            throw new ApiError(422, 'Consulte no máximo 93 dias por vez.')
          const [
            events,
            tasks,
            bookings,
            activities,
            content,
            campaigns,
            enrollments,
            jobs,
            bookingPages,
            contacts,
          ] = await Promise.all([
            context.admin
              .from('calendar_events')
              .select('*')
              .eq('workspace_id', context.workspaceId)
              .lt('start_at', range.to)
              .gt('end_at', range.from)
              .order('start_at'),
            context.admin
              .from('calendar_tasks')
              .select('*')
              .eq('workspace_id', context.workspaceId)
              .gte('due_at', range.from)
              .lt('due_at', range.to)
              .order('due_at'),
            context.admin
              .from('bookings')
              .select('*,booking_pages(title,slug)')
              .eq('workspace_id', context.workspaceId)
              .gte('start_at', range.from)
              .lt('start_at', range.to)
              .order('start_at'),
            context.admin
              .from('calendar_activities')
              .select('*')
              .eq('workspace_id', context.workspaceId)
              .gte('happened_at', range.from)
              .lt('happened_at', range.to)
              .order('happened_at', { ascending: false })
              .limit(500),
            context.admin
              .from('content_items')
              .select('id,title,kind,status,scheduled_at,published_at')
              .eq('workspace_id', context.workspaceId)
              .or(
                `and(scheduled_at.gte.${range.from},scheduled_at.lt.${range.to}),and(published_at.gte.${range.from},published_at.lt.${range.to})`,
              )
              .limit(300),
            context.admin
              .from('campaigns')
              .select('id,name,status,scheduled_at')
              .eq('workspace_id', context.workspaceId)
              .gte('scheduled_at', range.from)
              .lt('scheduled_at', range.to)
              .limit(200),
            context.admin
              .from('sequence_enrollments')
              .select(
                'id,status,next_run_at,sequences(name),contacts(display_name,full_name,username)',
              )
              .eq('workspace_id', context.workspaceId)
              .gte('next_run_at', range.from)
              .lt('next_run_at', range.to)
              .limit(300),
            context.admin
              .from('scheduled_jobs')
              .select('id,kind,status,run_at,last_error')
              .eq('workspace_id', context.workspaceId)
              .gte('run_at', range.from)
              .lt('run_at', range.to)
              .limit(300),
            context.admin
              .from('booking_pages')
              .select(
                'id,title,slug,duration_minutes,timezone,is_active,create_meet',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at'),
            context.admin
              .from('contacts')
              .select('id,display_name,full_name,username,email')
              .eq('workspace_id', context.workspaceId)
              .is('archived_at', null)
              .order('last_interaction_at', {
                ascending: false,
                nullsFirst: false,
              })
              .limit(250),
          ])
          for (const result of [
            events,
            tasks,
            bookings,
            activities,
            content,
            campaigns,
            enrollments,
            jobs,
            bookingPages,
            contacts,
          ])
            if (result.error) throw result.error
          const operationalItems = [
            ...(content.data ?? []).flatMap((item) => {
              const values = []
              if (item.scheduled_at)
                values.push({
                  id: `content-scheduled:${item.id}`,
                  source: 'content',
                  sourceId: item.id,
                  kind: 'content',
                  title: item.title,
                  status: item.status,
                  startAt: item.scheduled_at,
                  meta: { contentKind: item.kind, action: 'scheduled' },
                })
              if (item.published_at)
                values.push({
                  id: `content-published:${item.id}`,
                  source: 'content',
                  sourceId: item.id,
                  kind: 'activity',
                  title: `Publicado: ${item.title}`,
                  status: item.status,
                  startAt: item.published_at,
                  meta: { contentKind: item.kind, action: 'published' },
                })
              return values
            }),
            ...(campaigns.data ?? []).map((item) => ({
              id: `campaign:${item.id}`,
              source: 'campaign',
              sourceId: item.id,
              kind: 'campaign',
              title: item.name,
              status: item.status,
              startAt: item.scheduled_at,
            })),
            ...(enrollments.data ?? []).map((item) => {
              const sequence = item.sequences as unknown as {
                name?: string
              } | null
              const contact = item.contacts as unknown as {
                display_name?: string
                full_name?: string
                username?: string
              } | null
              return {
                id: `sequence:${item.id}`,
                source: 'sequence',
                sourceId: item.id,
                kind: 'sequence',
                title: `${sequence?.name ?? 'Sequência'} · ${contact?.display_name ?? contact?.full_name ?? contact?.username ?? 'Contato'}`,
                status: item.status,
                startAt: item.next_run_at,
              }
            }),
            ...(jobs.data ?? []).map((item) => ({
              id: `job:${item.id}`,
              source: 'job',
              sourceId: item.id,
              kind: 'job',
              title: `Execução: ${String(item.kind).replaceAll('_', ' ')}`,
              status: item.status,
              startAt: item.run_at,
              meta: { error: item.last_error },
            })),
          ]
          return Response.json(
            {
              events: events.data ?? [],
              tasks: tasks.data ?? [],
              bookings: bookings.data ?? [],
              activities: activities.data ?? [],
              operationalItems,
              bookingPages: bookingPages.data ?? [],
              contacts: contacts.data ?? [],
              permissions: { canManage: context.role !== 'viewer' },
              summary: {
                events: events.data?.length ?? 0,
                pendingTasks:
                  tasks.data?.filter((item) => item.status !== 'completed')
                    .length ?? 0,
                bookings:
                  bookings.data?.filter((item) => item.status === 'confirmed')
                    .length ?? 0,
                operations: operationalItems.length,
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao carregar o calendário.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const body = createSchema.parse(await readJsonBody(request))
          await assertOwnedReference({
            admin: context.admin,
            workspaceId: context.workspaceId,
            table: 'contacts',
            id: body.contactId,
          })
          await assertOwnedReference({
            admin: context.admin,
            workspaceId: context.workspaceId,
            table: 'calendar_connections',
            id: body.connectionId,
          })
          if (body.entity === 'task' && body.assignedTo) {
            const { count, error } = await context.admin
              .from('workspace_members')
              .select('user_id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('user_id', body.assignedTo)
            if (error) throw error
            if (!count)
              throw new ApiError(422, 'Responsável não pertence ao workspace.')
          }
          if (body.syncGoogle && !body.connectionId)
            throw new ApiError(422, 'Selecione uma conexão Google.')
          if (body.entity === 'event') {
            const connection = body.connectionId
              ? await context.admin
                  .from('calendar_connections')
                  .select('selected_calendar_id')
                  .eq('workspace_id', context.workspaceId)
                  .eq('id', body.connectionId)
                  .single()
              : null
            if (connection?.error) throw connection.error
            const calendarId = connection?.data.selected_calendar_id ?? null
            const { data: event, error } = await context.admin
              .from('calendar_events')
              .insert({
                workspace_id: context.workspaceId,
                calendar_connection_id: body.connectionId ?? null,
                provider: body.syncGoogle ? 'google' : 'local',
                calendar_id: calendarId,
                event_type: body.createMeet ? 'meeting' : body.eventType,
                title: body.title,
                description: body.description ?? null,
                start_at: body.startAt,
                end_at: body.endAt,
                all_day: body.allDay,
                timezone: body.timezone,
                status: body.syncGoogle ? 'sync_pending' : 'confirmed',
                location: body.location ?? null,
                attendees: body.attendees,
                contact_id: body.contactId ?? null,
                created_by: context.user.id,
                metadata: { createMeet: body.createMeet },
              })
              .select('*')
              .single()
            if (error) throw error
            let warning: string | null = null
            let result = event
            if (body.syncGoogle && body.connectionId && calendarId) {
              try {
                const google = await upsertGoogleEvent({
                  workspaceId: context.workspaceId,
                  connectionId: body.connectionId,
                  event: {
                    localId: event.id,
                    calendarId,
                    title: body.title,
                    description: body.description,
                    location: body.location,
                    startAt: body.startAt,
                    endAt: body.endAt,
                    allDay: body.allDay,
                    timezone: body.timezone,
                    createMeet: body.createMeet,
                    attendees: body.attendees,
                  },
                })
                const updated = await context.admin
                  .from('calendar_events')
                  .update({
                    provider_event_id: google.id,
                    status: 'confirmed',
                    meet_url: eventMeetUrl(google),
                    html_link: google.htmlLink ?? null,
                    last_synced_at: new Date().toISOString(),
                    sync_error: null,
                  })
                  .eq('id', event.id)
                  .eq('workspace_id', context.workspaceId)
                  .select('*')
                  .single()
                if (updated.error) throw updated.error
                result = updated.data
              } catch {
                warning =
                  'Evento salvo no Wal Chat, mas o Google precisa ser sincronizado novamente.'
                await context.admin
                  .from('calendar_events')
                  .update({
                    status: 'sync_error',
                    sync_error: 'google_sync_failed',
                  })
                  .eq('id', event.id)
              }
            }
            await activity({
              admin: context.admin,
              workspaceId: context.workspaceId,
              actorUserId: context.user.id,
              sourceType: 'calendar_events',
              sourceId: event.id,
              action: 'created',
              title: body.title,
              happenedAt: body.startAt,
              contactId: body.contactId,
            })
            return Response.json({ event: result, warning }, { status: 201 })
          }
          const connection = body.connectionId
            ? await context.admin
                .from('calendar_connections')
                .select('selected_tasklist_id')
                .eq('workspace_id', context.workspaceId)
                .eq('id', body.connectionId)
                .single()
            : null
          if (connection?.error) throw connection.error
          const tasklistId = connection?.data.selected_tasklist_id ?? null
          if (body.syncGoogle && !tasklistId)
            throw new ApiError(422, 'Selecione uma lista do Google Tasks.')
          const { data: task, error } = await context.admin
            .from('calendar_tasks')
            .insert({
              workspace_id: context.workspaceId,
              calendar_connection_id: body.connectionId ?? null,
              provider: body.syncGoogle ? 'google' : 'local',
              tasklist_id: tasklistId,
              title: body.title,
              notes: body.notes ?? null,
              due_at: body.dueAt ?? null,
              completed_at:
                body.status === 'completed' ? new Date().toISOString() : null,
              status: body.status,
              priority: body.priority,
              sync_status: body.syncGoogle ? 'pending' : 'local',
              contact_id: body.contactId ?? null,
              assigned_to: body.assignedTo ?? null,
              created_by: context.user.id,
            })
            .select('*')
            .single()
          if (error) throw error
          let warning: string | null = null
          let result = task
          if (body.syncGoogle && body.connectionId && tasklistId) {
            try {
              const google = await upsertGoogleTask({
                workspaceId: context.workspaceId,
                connectionId: body.connectionId,
                tasklistId,
                title: body.title,
                notes: body.notes,
                dueAt: body.dueAt,
                completed: body.status === 'completed',
              })
              const updated = await context.admin
                .from('calendar_tasks')
                .update({
                  provider_task_id: google.id,
                  sync_status: 'synced',
                  sync_error: null,
                })
                .eq('id', task.id)
                .select('*')
                .single()
              if (updated.error) throw updated.error
              result = updated.data
            } catch {
              warning =
                'Tarefa salva no Wal Chat, mas o Google Tasks precisa ser sincronizado novamente.'
              await context.admin
                .from('calendar_tasks')
                .update({
                  sync_status: 'error',
                  sync_error: 'google_sync_failed',
                })
                .eq('id', task.id)
            }
          }
          await activity({
            admin: context.admin,
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            sourceType: 'calendar_tasks',
            sourceId: task.id,
            action: 'created',
            title: body.title,
            happenedAt: body.dueAt ?? undefined,
            contactId: body.contactId,
          })
          return Response.json({ task: result, warning }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar no calendário.')
        }
      },
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const body = updateSchema.parse(await readJsonBody(request))
          await assertOwnedReference({
            admin: context.admin,
            workspaceId: context.workspaceId,
            table: 'contacts',
            id: body.contactId,
          })
          await assertOwnedReference({
            admin: context.admin,
            workspaceId: context.workspaceId,
            table: 'calendar_connections',
            id: body.connectionId,
          })
          if (body.entity === 'task' && body.assignedTo) {
            const { count, error } = await context.admin
              .from('workspace_members')
              .select('user_id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('user_id', body.assignedTo)
            if (error) throw error
            if (!count)
              throw new ApiError(422, 'Responsável não pertence ao workspace.')
          }
          if (body.entity === 'event') {
            const current = await context.admin
              .from('calendar_events')
              .select('*')
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.id)
              .maybeSingle()
            if (current.error) throw current.error
            if (!current.data) throw new ApiError(404, 'Evento não encontrado.')
            const startAt = body.startAt ?? current.data.start_at
            const endAt = body.endAt ?? current.data.end_at
            if (new Date(endAt) <= new Date(startAt))
              throw new ApiError(
                422,
                'O término precisa ser posterior ao início.',
              )
            const changes: Record<string, unknown> = {
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined
                ? { description: body.description }
                : {}),
              ...(body.startAt !== undefined ? { start_at: body.startAt } : {}),
              ...(body.endAt !== undefined ? { end_at: body.endAt } : {}),
              ...(body.allDay !== undefined ? { all_day: body.allDay } : {}),
              ...(body.timezone !== undefined
                ? { timezone: body.timezone }
                : {}),
              ...(body.eventType !== undefined
                ? { event_type: body.eventType }
                : {}),
              ...(body.location !== undefined
                ? { location: body.location }
                : {}),
              ...(body.contactId !== undefined
                ? { contact_id: body.contactId }
                : {}),
              ...(body.attendees !== undefined
                ? { attendees: body.attendees }
                : {}),
            }
            const wantsGoogle = Boolean(
              body.syncGoogle ?? current.data.provider === 'google',
            )
            const connectionId =
              body.connectionId ?? current.data.calendar_connection_id
            if (wantsGoogle && !connectionId)
              throw new ApiError(422, 'Selecione uma conexão Google.')
            let warning: string | null = null
            if (wantsGoogle && connectionId) {
              const connection = await context.admin
                .from('calendar_connections')
                .select('selected_calendar_id')
                .eq('workspace_id', context.workspaceId)
                .eq('id', connectionId)
                .single()
              if (connection.error) throw connection.error
              changes.status = 'sync_pending'
              changes.provider = 'google'
              changes.calendar_connection_id = connectionId
              changes.calendar_id = connection.data.selected_calendar_id
              const firstUpdate = await context.admin
                .from('calendar_events')
                .update(changes)
                .eq('id', body.id)
                .eq('workspace_id', context.workspaceId)
              if (firstUpdate.error) throw firstUpdate.error
              try {
                const google = await upsertGoogleEvent({
                  workspaceId: context.workspaceId,
                  connectionId,
                  providerEventId: current.data.provider_event_id,
                  event: {
                    localId: body.id,
                    calendarId: connection.data.selected_calendar_id,
                    title: body.title ?? current.data.title,
                    description: body.description ?? current.data.description,
                    location: body.location ?? current.data.location,
                    startAt,
                    endAt,
                    allDay: body.allDay ?? current.data.all_day,
                    timezone: body.timezone ?? current.data.timezone,
                    createMeet:
                      body.createMeet ?? Boolean(current.data.meet_url),
                    attendees: body.attendees ?? current.data.attendees ?? [],
                  },
                })
                Object.assign(changes, {
                  provider_event_id: google.id,
                  status: 'confirmed',
                  meet_url: eventMeetUrl(google),
                  html_link: google.htmlLink ?? current.data.html_link,
                  last_synced_at: new Date().toISOString(),
                  sync_error: null,
                })
              } catch {
                warning =
                  'Alteração local salva; a sincronização Google falhou.'
                Object.assign(changes, {
                  status: 'sync_error',
                  sync_error: 'google_sync_failed',
                })
              }
            }
            const updated = await context.admin
              .from('calendar_events')
              .update(changes)
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.id)
              .select('*')
              .single()
            if (updated.error) throw updated.error
            await activity({
              admin: context.admin,
              workspaceId: context.workspaceId,
              actorUserId: context.user.id,
              sourceType: 'calendar_events',
              sourceId: body.id,
              action: 'updated',
              title: updated.data.title,
            })
            return Response.json({ event: updated.data, warning })
          }
          const current = await context.admin
            .from('calendar_tasks')
            .select('*')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .maybeSingle()
          if (current.error) throw current.error
          if (!current.data) throw new ApiError(404, 'Tarefa não encontrada.')
          const changes: Record<string, unknown> = {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.dueAt !== undefined ? { due_at: body.dueAt } : {}),
            ...(body.status !== undefined
              ? {
                  status: body.status,
                  completed_at:
                    body.status === 'completed'
                      ? new Date().toISOString()
                      : null,
                }
              : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(body.contactId !== undefined
              ? { contact_id: body.contactId }
              : {}),
            ...(body.assignedTo !== undefined
              ? { assigned_to: body.assignedTo }
              : {}),
          }
          const wantsGoogle = Boolean(
            body.syncGoogle ?? current.data.provider === 'google',
          )
          let warning: string | null = null
          if (wantsGoogle) {
            const connectionId =
              body.connectionId ?? current.data.calendar_connection_id
            if (!connectionId)
              throw new ApiError(422, 'Selecione uma conexão Google.')
            const connection = await context.admin
              .from('calendar_connections')
              .select('selected_tasklist_id')
              .eq('workspace_id', context.workspaceId)
              .eq('id', connectionId)
              .single()
            if (connection.error) throw connection.error
            if (!connection.data.selected_tasklist_id)
              throw new ApiError(422, 'Selecione uma lista do Google Tasks.')
            changes.provider = 'google'
            changes.calendar_connection_id = connectionId
            changes.tasklist_id = connection.data.selected_tasklist_id
            changes.sync_status = 'pending'
            try {
              const google = await upsertGoogleTask({
                workspaceId: context.workspaceId,
                connectionId,
                tasklistId: connection.data.selected_tasklist_id,
                providerTaskId: current.data.provider_task_id,
                title: body.title ?? current.data.title,
                notes: body.notes ?? current.data.notes,
                dueAt: body.dueAt ?? current.data.due_at,
                completed: (body.status ?? current.data.status) === 'completed',
              })
              Object.assign(changes, {
                provider_task_id: google.id,
                sync_status: 'synced',
                sync_error: null,
              })
            } catch {
              warning =
                'Alteração local salva; a sincronização do Google Tasks falhou.'
              Object.assign(changes, {
                sync_status: 'error',
                sync_error: 'google_sync_failed',
              })
            }
          }
          const updated = await context.admin
            .from('calendar_tasks')
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .select('*')
            .single()
          if (updated.error) throw updated.error
          await activity({
            admin: context.admin,
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            sourceType: 'calendar_tasks',
            sourceId: body.id,
            action: 'updated',
            title: updated.data.title,
          })
          return Response.json({ task: updated.data, warning })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o calendário.')
        }
      },
      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const body = deleteSchema.parse(await readJsonBody(request))
          const table =
            body.entity === 'event' ? 'calendar_events' : 'calendar_tasks'
          const current = await context.admin
            .from(table)
            .select('*')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .maybeSingle()
          if (current.error) throw current.error
          if (!current.data) throw new ApiError(404, 'Item não encontrado.')
          if (
            body.entity === 'event' &&
            current.data.calendar_connection_id &&
            current.data.provider_event_id &&
            current.data.calendar_id
          )
            await deleteGoogleEvent({
              workspaceId: context.workspaceId,
              connectionId: current.data.calendar_connection_id,
              calendarId: current.data.calendar_id,
              providerEventId: current.data.provider_event_id,
            })
          if (
            body.entity === 'task' &&
            current.data.calendar_connection_id &&
            current.data.provider_task_id &&
            current.data.tasklist_id
          )
            await deleteGoogleTask({
              workspaceId: context.workspaceId,
              connectionId: current.data.calendar_connection_id,
              tasklistId: current.data.tasklist_id,
              providerTaskId: current.data.provider_task_id,
            })
          await activity({
            admin: context.admin,
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            sourceType: table,
            sourceId: body.id,
            action: 'deleted',
            title: current.data.title,
          })
          const deletion = await context.admin
            .from(table)
            .delete()
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
          if (deletion.error) throw deletion.error
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao excluir do calendário.')
        }
      },
    },
  },
})
