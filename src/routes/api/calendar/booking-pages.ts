/** CRUD das páginas de agendamento usadas por links, fluxos e agentes. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import {
  isValidTimeZone,
  isWeeklyAvailability,
  normalizeBookingSlug,
} from '../../../server/calendar-domain'
import { getServerEnv } from '../../../server/env.server'
import { readJsonBody } from '../../../server/request-body.server'

const windowSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})
const availabilitySchema = z
  .record(z.string(), z.array(windowSchema).max(4))
  .refine(isWeeklyAvailability, 'Disponibilidade semanal inválida.')

const fields = {
  title: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(3).max(80),
  description: z.string().trim().max(1000).nullable().optional(),
  durationMinutes: z.number().int().min(15).max(240),
  timezone: z.string().trim().min(1).max(80),
  availability: availabilitySchema,
  bufferBeforeMinutes: z.number().int().min(0).max(120),
  bufferAfterMinutes: z.number().int().min(0).max(120),
  minimumNoticeMinutes: z.number().int().min(0).max(43200),
  maxAdvanceDays: z.number().int().min(1).max(365),
  createMeet: z.boolean(),
  requirePhone: z.boolean(),
  confirmationMessage: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean(),
  connectionId: z.uuid().nullable().optional(),
  calendarId: z.string().min(1).max(1024).default('primary'),
}
const createSchema = z.object(fields)
const updateSchema = z
  .object({ id: z.uuid(), ...fields })
  .partial()
  .required({ id: true })
const deleteSchema = z.object({ id: z.uuid() })

export const Route = createFileRoute('/api/calendar/booking-pages')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const { data, error } = await context.admin
            .from('booking_pages')
            .select(
              'id,title,slug,description,duration_minutes,timezone,availability,buffer_before_minutes,buffer_after_minutes,minimum_notice_minutes,max_advance_days,create_meet,require_phone,confirmation_message,is_active,calendar_connection_id,calendar_id,created_at,updated_at',
            )
            .eq('workspace_id', context.workspaceId)
            .order('created_at')
          if (error) throw error
          const origin = getServerEnv().APP_ORIGIN
          return Response.json({
            pages: data.map((page) => ({
              id: page.id,
              title: page.title,
              slug: page.slug,
              description: page.description,
              durationMinutes: page.duration_minutes,
              timezone: page.timezone,
              availability: page.availability,
              bufferBeforeMinutes: page.buffer_before_minutes,
              bufferAfterMinutes: page.buffer_after_minutes,
              minimumNoticeMinutes: page.minimum_notice_minutes,
              maxAdvanceDays: page.max_advance_days,
              createMeet: page.create_meet,
              requirePhone: page.require_phone,
              confirmationMessage: page.confirmation_message,
              isActive: page.is_active,
              connectionId: page.calendar_connection_id,
              calendarId: page.calendar_id,
              publicUrl: `${origin}/agendar/${page.slug}`,
              createdAt: page.created_at,
              updatedAt: page.updated_at,
            })),
            permissions: { canManage: context.role !== 'viewer' },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar links de agenda.')
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
          if (!isValidTimeZone(body.timezone))
            throw new ApiError(422, 'Fuso horário inválido.')
          const slug = normalizeBookingSlug(body.slug)
          if (slug.length < 3) throw new ApiError(422, 'Slug inválido.')
          if (body.connectionId) {
            const connection = await context.admin
              .from('calendar_connections')
              .select('id,available_calendars')
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.connectionId)
              .eq('status', 'connected')
              .maybeSingle()
            if (connection.error) throw connection.error
            if (!connection.data)
              throw new ApiError(422, 'Conexão Google indisponível.')
            const calendars = Array.isArray(connection.data.available_calendars)
              ? (connection.data.available_calendars as Array<{ id?: string }>)
              : []
            if (!calendars.some((calendar) => calendar.id === body.calendarId))
              throw new ApiError(422, 'Calendário Google não autorizado.')
          }
          const { data, error } = await context.admin
            .from('booking_pages')
            .insert({
              workspace_id: context.workspaceId,
              calendar_connection_id: body.connectionId ?? null,
              calendar_id: body.calendarId,
              slug,
              title: body.title,
              description: body.description ?? null,
              duration_minutes: body.durationMinutes,
              timezone: body.timezone,
              availability: body.availability,
              buffer_before_minutes: body.bufferBeforeMinutes,
              buffer_after_minutes: body.bufferAfterMinutes,
              minimum_notice_minutes: body.minimumNoticeMinutes,
              max_advance_days: body.maxAdvanceDays,
              create_meet: body.createMeet,
              require_phone: body.requirePhone,
              confirmation_message: body.confirmationMessage ?? null,
              is_active: body.isActive,
              created_by: context.user.id,
            })
            .select('id,slug')
            .single()
          if (error?.code === '23505')
            throw new ApiError(409, 'Este endereço de agenda já está em uso.')
          if (error) throw error
          return Response.json(
            {
              id: data.id,
              slug: data.slug,
              publicUrl: `${getServerEnv().APP_ORIGIN}/agendar/${data.slug}`,
            },
            { status: 201 },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar link de agenda.')
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
          if (body.timezone && !isValidTimeZone(body.timezone))
            throw new ApiError(422, 'Fuso horário inválido.')
          if (body.connectionId) {
            const connection = await context.admin
              .from('calendar_connections')
              .select('available_calendars')
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.connectionId)
              .eq('status', 'connected')
              .maybeSingle()
            if (connection.error) throw connection.error
            if (!connection.data)
              throw new ApiError(422, 'Conexão Google indisponível.')
            if (
              body.calendarId &&
              !(
                connection.data.available_calendars as Array<{ id?: string }>
              ).some((calendar) => calendar.id === body.calendarId)
            )
              throw new ApiError(422, 'Calendário Google não autorizado.')
          }
          const changes: Record<string, unknown> = {}
          if (body.title !== undefined) changes.title = body.title
          if (body.slug !== undefined) {
            const slug = normalizeBookingSlug(body.slug)
            if (slug.length < 3) throw new ApiError(422, 'Slug inválido.')
            changes.slug = slug
          }
          if (body.description !== undefined)
            changes.description = body.description
          if (body.durationMinutes !== undefined)
            changes.duration_minutes = body.durationMinutes
          if (body.timezone !== undefined) changes.timezone = body.timezone
          if (body.availability !== undefined)
            changes.availability = body.availability
          if (body.bufferBeforeMinutes !== undefined)
            changes.buffer_before_minutes = body.bufferBeforeMinutes
          if (body.bufferAfterMinutes !== undefined)
            changes.buffer_after_minutes = body.bufferAfterMinutes
          if (body.minimumNoticeMinutes !== undefined)
            changes.minimum_notice_minutes = body.minimumNoticeMinutes
          if (body.maxAdvanceDays !== undefined)
            changes.max_advance_days = body.maxAdvanceDays
          if (body.createMeet !== undefined)
            changes.create_meet = body.createMeet
          if (body.requirePhone !== undefined)
            changes.require_phone = body.requirePhone
          if (body.confirmationMessage !== undefined)
            changes.confirmation_message = body.confirmationMessage
          if (body.isActive !== undefined) changes.is_active = body.isActive
          if (body.connectionId !== undefined)
            changes.calendar_connection_id = body.connectionId
          if (body.calendarId !== undefined)
            changes.calendar_id = body.calendarId
          const { data, error } = await context.admin
            .from('booking_pages')
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .select('id,slug')
            .maybeSingle()
          if (error?.code === '23505')
            throw new ApiError(409, 'Este endereço de agenda já está em uso.')
          if (error) throw error
          if (!data) throw new ApiError(404, 'Link de agenda não encontrado.')
          return Response.json({
            ok: true,
            publicUrl: `${getServerEnv().APP_ORIGIN}/agendar/${data.slug}`,
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar link de agenda.')
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
          const { data, error } = await context.admin
            .from('booking_pages')
            .update({ is_active: false })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data) throw new ApiError(404, 'Link de agenda não encontrado.')
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao desativar link de agenda.')
        }
      },
    },
  },
})
