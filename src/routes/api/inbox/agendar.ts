/**
 * Agendar uma reunião sem sair da conversa.
 *
 * É a mesma operação que a página pública e a IA fazem — passa pelo
 * `booking-service.server`, então os três caminhos disputam o mesmo horário e
 * nenhum deles consegue vender um horário que outro já vendeu.
 *
 * A razão de existir é de fluxo, não de tecnologia: até aqui, marcar com alguém
 * que estava no direct exigia sair do Inbox, achar a agenda, copiar o link,
 * voltar e colar. Cada passo desses é um lugar onde o atendimento esfria.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import {
  createBooking,
  findAvailableSlots,
  loadBookingPageForWorkspace,
  localDateInZone,
} from '../../../server/booking-service.server'
import { formatSlotLabel, spreadSlots } from '../../../server/ai-tools'
import { assertRateLimit } from '../../../server/rate-limit.server'
import { readJsonBody } from '../../../server/request-body.server'

const querySchema = z.object({
  dias: z.coerce.number().int().min(1).max(30).default(7),
})

const bodySchema = z.object({
  contactId: z.uuid(),
  startAt: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export const Route = createFileRoute('/api/inbox/agendar')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          // O limite tambem vale na leitura: e ela que dispara o freeBusy do
          // Google, e a cota daquela API e do workspace inteiro. Uma tela em
          // laco aqui derrubaria tambem a pagina publica e a IA, que dependem
          // da mesma chamada. O teto e mais alto que o da escrita porque
          // consultar horarios e o gesto normal de quem esta atendendo.
          await assertRateLimit({
            namespace: 'inbox-agendar-consulta',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 90,
            windowSeconds: 60,
          })
          const { dias } = querySchema.parse(
            Object.fromEntries(new URL(request.url).searchParams),
          )
          const page = await loadBookingPageForWorkspace({
            workspaceId: context.workspaceId,
          })
          const hoje = localDateInZone(new Date().toISOString(), page.timezone)
          const ate = new Date(
            new Date(`${hoje}T12:00:00.000Z`).getTime() + dias * 86_400_000,
          )
            .toISOString()
            .slice(0, 10)
          // A mesma distribuição por dias que a IA usa: uma lista com trinta
          // horários da mesma terça não ajuda ninguém a escolher.
          const slots = spreadSlots(
            await findAvailableSlots(page, hoje, ate),
            12,
          )
          return Response.json(
            {
              agenda: { titulo: page.title, minutos: page.duration_minutes },
              horarios: slots.map((slot) => ({
                inicio: slot.startAt,
                quando: formatSlotLabel(slot.startAt, page.timezone),
              })),
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar horários.')
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
          await assertRateLimit({
            namespace: 'inbox-agendar',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 30,
            windowSeconds: 60,
          })
          const body = bodySchema.parse(await readJsonBody(request))

          // O contato precisa ser deste workspace. Sem esta checagem, um id
          // colado de fora marcaria reunião no nome de outra pessoa.
          const { data: contato, error } = await context.supabase
            .from('contacts')
            .select('id')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.contactId)
            .maybeSingle()
          if (error) throw error
          if (!contato) throw new ApiError(404, 'Contato não encontrado.')

          const page = await loadBookingPageForWorkspace({
            workspaceId: context.workspaceId,
          })
          const booking = await createBooking({
            page,
            name: body.name,
            email: body.email,
            notes: body.notes ?? null,
            startAt: body.startAt,
            source: 'manual',
            contactId: body.contactId,
          })
          return Response.json({
            reuniao: {
              id: booking.id,
              quando: formatSlotLabel(booking.startAt, booking.timezone),
              linkMeet: booking.meetUrl,
              conviteEnviado: booking.invited,
              aviso: booking.warning,
            },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao agendar.')
        }
      },
    },
  },
})
