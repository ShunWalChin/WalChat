/** Disponibilidade pública e reserva transacional para links de agendamento. */
import { createFileRoute } from '@tanstack/react-router'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
} from '../../../../server/api-auth.server'
import {
  generateAvailableSlots,
  zonedDateTimeToUtc,
} from '../../../../server/calendar-domain'
import type {
  BusyRange,
  WeeklyAvailability,
} from '../../../../server/calendar-domain'
import {
  queryGoogleFreeBusy,
  upsertGoogleEvent,
} from '../../../../server/google-calendar.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'
import { requestIdentity } from '../../../../server/request-identity.server'
import { getSupabaseAdmin } from '../../../../server/supabase-admin.server'

const querySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
})
const bookingSchema = z.object({
  startAt: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  phone: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  source: z
    .enum(['public_page', 'ai_agent', 'trigger', 'sequence'])
    .default('public_page'),
  idempotencyKey: z.uuid().optional(),
})

type BookingPage = {
  id: string
  slug: string
  workspace_id: string
  title: string
  description: string | null
  duration_minutes: number
  timezone: string
  availability: WeeklyAvailability
  buffer_before_minutes: number
  buffer_after_minutes: number
  minimum_notice_minutes: number
  max_advance_days: number
  create_meet: boolean
  require_phone: boolean
  confirmation_message: string | null
  calendar_connection_id: string | null
  calendar_id: string
}

function requireAdmin() {
  const admin = getSupabaseAdmin()
  if (!admin) throw new ApiError(503, 'Agenda temporariamente indisponível.')
  return admin
}

async function loadPage(slug: string) {
  const admin = requireAdmin()
  const { data, error } = await admin
    .from('booking_pages')
    .select(
      'id,workspace_id,slug,title,description,duration_minutes,timezone,availability,buffer_before_minutes,buffer_after_minutes,minimum_notice_minutes,max_advance_days,create_meet,require_phone,confirmation_message,calendar_connection_id,calendar_id',
    )
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ApiError(404, 'Agenda não encontrada ou desativada.')
  return data
}

function nextDate(date: string) {
  return new Date(new Date(`${date}T12:00:00.000Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10)
}

async function busyForPage(page: BookingPage, from: string, to: string) {
  const admin = requireAdmin()
  const timeMin = zonedDateTimeToUtc(from, '00:00', page.timezone).toISOString()
  const timeMax = zonedDateTimeToUtc(
    nextDate(to),
    '00:00',
    page.timezone,
  ).toISOString()
  const local = await admin
    .from('bookings')
    .select('start_at,end_at')
    .eq('booking_page_id', page.id)
    .in('status', ['pending', 'confirmed'])
    .lt('start_at', timeMax)
    .gt('end_at', timeMin)
  if (local.error) throw local.error
  const busy: BusyRange[] = local.data.map((item) => ({
    start: item.start_at,
    end: item.end_at,
  }))
  if (page.calendar_connection_id) {
    try {
      busy.push(
        ...(await queryGoogleFreeBusy({
          workspaceId: page.workspace_id,
          connectionId: page.calendar_connection_id,
          calendarId: page.calendar_id,
          timeMin,
          timeMax,
          timezone: page.timezone,
        })),
      )
    } catch {
      // Falha fechada: nunca oferecemos um horário sem validar o Google ligado.
      throw new ApiError(
        503,
        'Não foi possível validar a agenda Google agora. Tente novamente em instantes.',
      )
    }
  }
  return busy
}

async function available(page: BookingPage, from: string, to: string) {
  const busy = await busyForPage(page, from, to)
  return generateAvailableSlots({
    from,
    to,
    timezone: page.timezone,
    availability: page.availability,
    durationMinutes: page.duration_minutes,
    bufferBeforeMinutes: page.buffer_before_minutes,
    bufferAfterMinutes: page.buffer_after_minutes,
    minimumNoticeMinutes: page.minimum_notice_minutes,
    maxAdvanceDays: page.max_advance_days,
    busy,
  })
}

function localDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export const Route = createFileRoute('/api/public/bookings/$slug')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await assertRateLimit({
            namespace: 'public-booking-availability',
            identity: requestIdentity(request),
            limit: 60,
            windowSeconds: 600,
          })
          const page = await loadPage(params.slug)
          const url = new URL(request.url)
          const today = localDate(new Date().toISOString(), page.timezone)
          const fallbackTo = new Date(
            new Date(`${today}T12:00:00.000Z`).getTime() + 13 * 86_400_000,
          )
            .toISOString()
            .slice(0, 10)
          const query = querySchema.parse({
            from: url.searchParams.get('from') ?? today,
            to: url.searchParams.get('to') ?? fallbackTo,
          })
          const span =
            new Date(`${query.to}T00:00:00Z`).getTime() -
            new Date(`${query.from}T00:00:00Z`).getTime()
          if (span < 0 || span > 31 * 86_400_000)
            throw new ApiError(422, 'Consulte no máximo 31 dias.')
          const slots = await available(page, query.from, query.to)
          return Response.json(
            {
              page: {
                title: page.title,
                description: page.description,
                durationMinutes: page.duration_minutes,
                timezone: page.timezone,
                requirePhone: page.require_phone,
                createMeet:
                  page.create_meet && Boolean(page.calendar_connection_id),
              },
              slots,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar horários.')
        }
      },
      POST: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          await assertRateLimit({
            namespace: 'public-booking',
            identity: requestIdentity(request),
            limit: 12,
            windowSeconds: 600,
          })
          const body = bookingSchema.parse(await readJsonBody(request))
          const page = await loadPage(params.slug)
          if (page.require_phone && !body.phone)
            throw new ApiError(422, 'Informe seu telefone.')
          const admin = requireAdmin()
          const idempotencyKey = body.idempotencyKey ?? randomUUID()
          const existing = await admin
            .from('bookings')
            .select('id,guest_email,start_at,end_at,timezone,meet_url,status')
            .eq('workspace_id', page.workspace_id)
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle()
          if (existing.error) throw existing.error
          if (existing.data) {
            if (existing.data.guest_email !== body.email.toLowerCase())
              throw new ApiError(409, 'Identificador de reserva já utilizado.')
            if (!['pending', 'confirmed'].includes(existing.data.status))
              throw new ApiError(
                409,
                'Esta tentativa de reserva já foi encerrada. Escolha o horário novamente.',
              )
            return Response.json({
              booking: {
                id: existing.data.id,
                startAt: existing.data.start_at,
                endAt: existing.data.end_at,
                timezone: existing.data.timezone,
                meetUrl: existing.data.meet_url,
                status: existing.data.status,
              },
              confirmationMessage: page.confirmation_message,
            })
          }
          const date = localDate(body.startAt, page.timezone)
          const slots = await available(page, date, date)
          const slot = slots.find((item) => item.startAt === body.startAt)
          if (!slot)
            throw new ApiError(
              409,
              'Este horário não está mais disponível. Escolha outro.',
            )
          let contactId: string | null = null
          const contact = await admin
            .from('contacts')
            .select('id')
            .eq('workspace_id', page.workspace_id)
            .ilike('email', body.email)
            .limit(1)
            .maybeSingle()
          if (contact.error) throw contact.error
          contactId = contact.data?.id ?? null
          if (!contactId) {
            const created = await admin
              .from('contacts')
              .insert({
                workspace_id: page.workspace_id,
                platform: 'manual',
                instagram_account_id: null,
                instagram_user_id: null,
                whatsapp_account_id: null,
                whatsapp_user_id: null,
                display_name: body.name,
                email: body.email.toLowerCase(),
                phone: body.phone ?? null,
                import_source: 'booking_page',
                marketing_consent: 'unknown',
              })
              .select('id')
              .single()
            if (created.error) throw created.error
            contactId = created.data.id
          }
          const reservation = await admin.rpc('reserve_calendar_booking', {
            target_booking_page_id: page.id,
            target_contact_id: contactId,
            target_guest_name: body.name,
            target_guest_email: body.email,
            target_guest_phone: body.phone ?? null,
            target_start_at: slot.startAt,
            target_end_at: slot.endAt,
            target_timezone: page.timezone,
            target_source: body.source,
            target_notes: body.notes ?? null,
            target_idempotency_key: idempotencyKey,
          })
          if (reservation.error) {
            if (reservation.error.message.includes('booking_slot_unavailable'))
              throw new ApiError(
                409,
                'Este horário acabou de ser reservado. Escolha outro.',
              )
            throw reservation.error
          }
          const bookingId = reservation.data as string
          const bookingResult = await admin
            .from('bookings')
            .select('id,status,start_at,end_at,timezone,meet_url')
            .eq('workspace_id', page.workspace_id)
            .eq('id', bookingId)
            .single()
          if (bookingResult.error) throw bookingResult.error
          if (!['pending', 'confirmed'].includes(bookingResult.data.status))
            throw new ApiError(
              409,
              'Esta tentativa de reserva já foi encerrada. Escolha o horário novamente.',
            )
          const { data: event, error: eventError } = await admin
            .from('calendar_events')
            .select('*')
            .eq('workspace_id', page.workspace_id)
            .eq('booking_id', bookingId)
            .limit(1)
            .single()
          if (eventError) throw eventError
          let meetUrl: string | null = null
          let warning: string | null = null
          if (page.calendar_connection_id) {
            try {
              const google = await upsertGoogleEvent({
                workspaceId: page.workspace_id,
                connectionId: page.calendar_connection_id,
                event: {
                  localId: event.id,
                  calendarId: page.calendar_id,
                  title: event.title,
                  description: event.description,
                  startAt: event.start_at,
                  endAt: event.end_at,
                  allDay: false,
                  timezone: page.timezone,
                  createMeet: page.create_meet,
                  attendees: [{ email: body.email, displayName: body.name }],
                },
              })
              meetUrl =
                google.hangoutLink ??
                google.conferenceData?.entryPoints?.find(
                  (entry) => entry.entryPointType === 'video',
                )?.uri ??
                null
              await admin
                .from('calendar_events')
                .update({
                  provider_event_id: google.id,
                  status: 'confirmed',
                  meet_url: meetUrl,
                  html_link: google.htmlLink ?? null,
                  last_synced_at: new Date().toISOString(),
                  sync_error: null,
                })
                .eq('id', event.id)
              await admin
                .from('bookings')
                .update({ google_event_id: google.id, meet_url: meetUrl })
                .eq('id', bookingId)
            } catch {
              warning =
                'Sua reserva foi confirmada, mas o convite Google será sincronizado pela equipe.'
              await admin
                .from('calendar_events')
                .update({
                  status: 'sync_error',
                  sync_error: 'google_sync_failed',
                })
                .eq('id', event.id)
            }
          }
          await admin
            .from('bookings')
            .update({ calendar_event_id: event.id })
            .eq('id', bookingId)
          return Response.json(
            {
              booking: {
                id: bookingId,
                startAt: bookingResult.data.start_at,
                endAt: bookingResult.data.end_at,
                timezone: bookingResult.data.timezone,
                meetUrl: meetUrl ?? bookingResult.data.meet_url,
                status: bookingResult.data.status,
              },
              confirmationMessage: page.confirmation_message,
              warning,
            },
            { status: 201 },
          )
        } catch (error) {
          return apiErrorResponse(
            error,
            'Não foi possível confirmar o horário.',
          )
        }
      },
    },
  },
})
