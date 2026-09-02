/** Reenfileira explicitamente um evento terminal preservando o event_id. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { adConversionReplaySchema } from '../../../../server/ad-conversions-contract'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

export const Route = createFileRoute('/api/integrations/conversions/replay')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'ad-conversions-replay',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 20,
            windowSeconds: 300,
          })
          const body = adConversionReplaySchema.parse(
            await readJsonBody(request),
          )
          const eventResult = await context.admin
            .from('ad_conversion_events')
            .select('id,rule_id,lead_id,status')
            .eq('id', body.eventId)
            .eq('workspace_id', context.workspaceId)
            .in('status', ['failed', 'partial', 'blocked'])
            .maybeSingle()
          if (eventResult.error) throw eventResult.error
          if (!eventResult.data)
            return Response.json(
              { error: 'Evento não está disponível para reenvio.' },
              { status: 409 },
            )
          const dedupeKey = `ad-conversion:${eventResult.data.rule_id}:${eventResult.data.lead_id}`
          const [eventUpdate, jobUpdate] = await Promise.all([
            context.admin
              .from('ad_conversion_events')
              .update({
                status: 'pending',
                error_code: null,
                processed_at: null,
              })
              .eq('id', body.eventId)
              .eq('workspace_id', context.workspaceId),
            context.admin
              .from('scheduled_jobs')
              .update({
                status: 'pending',
                attempts: 0,
                last_error: null,
                locked_at: null,
                run_at: new Date().toISOString(),
              })
              .eq('workspace_id', context.workspaceId)
              .eq('dedupe_key', dedupeKey),
          ])
          if (eventUpdate.error) throw eventUpdate.error
          if (jobUpdate.error) throw jobUpdate.error
          return Response.json({ queued: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao reenfileirar a conversão.')
        }
      },
    },
  },
})
