/**
 * Disponibilidade pública e reserva de um link de agendamento.
 *
 * A rota é fina de propósito: ela cuida de HTTP — limite de taxa, validação da
 * entrada, formato da resposta — e delega a decisão de agenda para
 * `booking-service.server`, que é o mesmo caminho usado pela IA e pelas
 * automações. Enquanto a composição de disponibilidade viveu aqui dentro, era
 * impossível outro caminho agendar sem copiá-la.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
} from '../../../../server/api-auth.server'
import {
  BookingError,
  createBooking,
  findAvailableSlots,
  loadBookingPageBySlug,
  localDateInZone,
} from '../../../../server/booking-service.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'
import { requestIdentity } from '../../../../server/request-identity.server'

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
          const page = await loadBookingPageBySlug(params.slug)
          const url = new URL(request.url)
          const today = localDateInZone(new Date().toISOString(), page.timezone)
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
            throw new BookingError(
              422,
              'range_too_wide',
              'Consulte no máximo 31 dias.',
            )
          const slots = await findAvailableSlots(page, query.from, query.to)
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
          const page = await loadBookingPageBySlug(params.slug)
          const booking = await createBooking({
            page,
            name: body.name,
            email: body.email,
            phone: body.phone ?? null,
            notes: body.notes ?? null,
            startAt: body.startAt,
            source: body.source,
            idempotencyKey: body.idempotencyKey ?? null,
          })
          return Response.json(
            {
              booking: {
                id: booking.id,
                startAt: booking.startAt,
                endAt: booking.endAt,
                timezone: booking.timezone,
                meetUrl: booking.meetUrl,
                status: booking.status,
              },
              confirmationMessage: page.confirmation_message,
              warning: booking.warning,
            },
            // Uma reserva reaproveitada por idempotência não é criação nova:
            // repetir o POST devolve o que já existe, e o 200 diz isso.
            { status: booking.reused ? 200 : 201 },
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
