/** Trilha unificada de mutações operacionais e integrações do workspace. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { workspaceMemberOptions } from '../../server/contacts-crm.server'

const querySchema = z.object({
  limit: z.coerce.number().int().min(10).max(200).default(100),
  action: z.string().trim().max(100).default(''),
})

export const Route = createFileRoute('/api/audit')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const url = new URL(request.url)
          const query = querySchema.parse({
            limit: url.searchParams.get('limit') ?? undefined,
            action: url.searchParams.get('action') ?? '',
          })
          let auditQuery = context.admin
            .from('api_audit_log')
            .select(
              'id,actor_user_id,action,resource_type,resource_id,changes,user_agent,created_at',
            )
            .eq('workspace_id', context.workspaceId)
            .order('created_at', { ascending: false })
            .limit(query.limit)
          if (query.action)
            auditQuery = auditQuery.ilike('action', `%${query.action}%`)
          const [auditResult, integrationResult, members] = await Promise.all([
            auditQuery,
            context.admin
              .from('integration_audit_logs')
              .select(
                'id,provider,action,status,resource_id,details,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at', { ascending: false })
              .limit(Math.min(50, query.limit)),
            workspaceMemberOptions({
              admin: context.admin,
              workspaceId: context.workspaceId,
            }),
          ])
          if (auditResult.error) throw auditResult.error
          if (integrationResult.error) throw integrationResult.error
          const memberNames = new Map(
            members.map((member) => [member.id, member.name]),
          )
          const events = [
            ...auditResult.data.map((event) => ({
              id: event.id,
              source: 'operation',
              actorName: event.actor_user_id
                ? (memberNames.get(event.actor_user_id) ?? 'Membro')
                : 'Sistema',
              action: event.action,
              resourceType: event.resource_type,
              resourceId: event.resource_id,
              status: 'success',
              details: event.changes,
              createdAt: event.created_at,
            })),
            ...integrationResult.data.map((event) => ({
              id: event.id,
              source: 'integration',
              actorName: 'Sistema',
              action: event.action,
              resourceType: event.provider,
              resourceId: event.resource_id,
              status: event.status,
              details: event.details,
              createdAt: event.created_at,
            })),
          ]
            .sort((left, right) =>
              right.createdAt.localeCompare(left.createdAt),
            )
            .slice(0, query.limit)
          return Response.json(
            { events, members },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar a auditoria.')
        }
      },
    },
  },
})
