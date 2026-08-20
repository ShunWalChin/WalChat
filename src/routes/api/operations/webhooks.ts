/** Observabilidade sanitizada e replay seguro dos webhooks da Meta. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { writeIntegrationAudit } from '../../../server/integration-credentials.server'
import { replayMetaWebhook } from '../../../server/queue.server'
import { readJsonBody } from '../../../server/request-body.server'

const querySchema = z.object({
  status: z
    .enum(['queued', 'processing', 'processed', 'failed', 'ignored'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
const replaySchema = z.object({ eventId: z.string().uuid() })

export const Route = createFileRoute('/api/operations/webhooks')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const url = new URL(request.url)
          const query = querySchema.parse({
            status: url.searchParams.get('status') ?? undefined,
            limit: url.searchParams.get('limit') ?? undefined,
          })
          let eventsQuery = context.admin
            .from('webhook_events')
            .select(
              'id,meta_event_key,provider,external_account_id,event_type,status,attempts,last_error,received_at,processing_started_at,processed_at,duration_ms,replayed_at',
            )
            .eq('workspace_id', context.workspaceId)
            .order('received_at', { ascending: false })
            .limit(query.limit)
          if (query.status) eventsQuery = eventsQuery.eq('status', query.status)
          const statuses = [
            'queued',
            'processing',
            'processed',
            'failed',
            'ignored',
          ] as const
          const [{ data: events, error }, ...countResults] = await Promise.all([
            eventsQuery,
            ...statuses.map((status) =>
              context.admin
                .from('webhook_events')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', context.workspaceId)
                .eq('status', status),
            ),
          ])
          if (error) throw error
          for (const result of countResults)
            if (result.error) throw result.error
          return Response.json(
            {
              events,
              summary: Object.fromEntries(
                statuses.map((status, index) => [
                  status,
                  countResults[index].count ?? 0,
                ]),
              ),
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar os webhooks.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = replaySchema.parse(await readJsonBody(request))
          const { data: event, error } = await context.admin
            .from('webhook_events')
            .select('meta_event_key,payload,status')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.eventId)
            .maybeSingle()
          if (error) throw error
          if (!event)
            return Response.json(
              { error: 'Evento não encontrado.' },
              { status: 404 },
            )
          if (event.status !== 'failed')
            return Response.json(
              { error: 'Somente eventos com falha podem ser reenfileirados.' },
              { status: 409 },
            )
          const replay = await replayMetaWebhook({
            metaEventKey: event.meta_event_key,
            payload: event.payload,
            replayedBy: context.user.id,
          })
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'meta',
            action: 'webhook_replayed',
            status: 'success',
            resourceId: event.meta_event_key,
          })
          return Response.json({ ok: true, ...replay })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao reenfileirar o webhook.')
        }
      },
    },
  },
})
