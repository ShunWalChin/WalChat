/** Operação interna de agendamentos: confirmar, concluir, cancelar ou no-show. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { deleteGoogleEvent } from '../../../server/google-calendar.server'
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
          const booking = await context.admin
            .from('bookings')
            .select(
              'id,calendar_event_id,calendar_events(calendar_connection_id,provider_event_id,calendar_id)',
            )
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .maybeSingle()
          if (booking.error) throw booking.error
          if (!booking.data)
            throw new ApiError(404, 'Agendamento não encontrado.')
          const event = booking.data.calendar_events as unknown as {
            calendar_connection_id?: string
            provider_event_id?: string
            calendar_id?: string
          } | null
          if (
            body.status === 'cancelled' &&
            event?.calendar_connection_id &&
            event.provider_event_id &&
            event.calendar_id
          )
            await deleteGoogleEvent({
              workspaceId: context.workspaceId,
              connectionId: event.calendar_connection_id,
              providerEventId: event.provider_event_id,
              calendarId: event.calendar_id,
            })
          const { error } = await context.admin
            .from('bookings')
            .update({ status: body.status })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
          if (error) throw error
          if (booking.data.calendar_event_id && body.status === 'cancelled')
            await context.admin
              .from('calendar_events')
              .update({ status: 'cancelled' })
              .eq('workspace_id', context.workspaceId)
              .eq('id', booking.data.calendar_event_id)
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar agendamento.')
        }
      },
    },
  },
})
