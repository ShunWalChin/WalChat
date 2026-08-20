/** Sincronização manual idempotente do Google Calendar e Google Tasks. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { syncGoogleConnection } from '../../../../server/google-calendar.server'
import { writeIntegrationAudit } from '../../../../server/integration-credentials.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { readJsonBody } from '../../../../server/request-body.server'

const schema = z.object({
  connectionId: z.uuid(),
  forceFull: z.boolean().default(false),
})

export const Route = createFileRoute('/api/integrations/google/sync')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const body = schema.parse(await readJsonBody(request))
          await assertRateLimit({
            namespace: 'google-calendar-sync',
            identity: `${context.workspaceId}:${body.connectionId}`,
            limit: 10,
            windowSeconds: 600,
          })
          const result = await syncGoogleConnection({
            workspaceId: context.workspaceId,
            connectionId: body.connectionId,
            forceFull: body.forceFull,
          })
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'google',
            action: 'calendar_synced',
            status: 'success',
            resourceId: body.connectionId,
            details: result,
          })
          return Response.json(result)
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao sincronizar com o Google.')
        }
      },
    },
  },
})
