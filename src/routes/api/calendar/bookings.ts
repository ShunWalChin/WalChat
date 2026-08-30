/**
 * Operação interna de agendamentos: confirmar, concluir, cancelar ou no-show.
 *
 * O cancelamento delega para `booking-service.server`, que é o mesmo caminho da
 * IA e da página pública. Manter uma segunda cópia aqui significaria que um dia
 * uma delas apagaria o evento no Google e a outra não — e a diferença só
 * apareceria quando alguém entrasse numa reunião cancelada.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { cancelBooking } from '../../../server/booking-service.server'
import { readJsonBody } from '../../../server/request-body.server'

const schema = z.object({
  id: z.uuid(),
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']),
})

export const Route = createFileRoute('/api/calendar/bookings')({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const body = schema.parse(await readJsonBody(request))

          if (body.status === 'cancelled') {
            const resultado = await cancelBooking({
              workspaceId: context.workspaceId,
              bookingId: body.id,
            })
            return Response.json({ ok: true, ...resultado })
          }

          const booking = await context.admin
            .from('bookings')
            .update({ status: body.status })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .select('id')
            .maybeSingle()
          if (booking.error) throw booking.error
          if (!booking.data)
            throw new ApiError(404, 'Agendamento não encontrado.')
          return Response.json({ ok: true, id: booking.data.id })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar agendamento.')
        }
      },
    },
  },
})
