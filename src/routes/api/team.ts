/** Disponibilidade, capacidade e estratégia de distribuição da equipe. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { updateAttendantSchema } from '../../server/crm-pipeline-contract'
import { writeCrmAudit } from '../../server/crm-pipeline.server'
import { workspaceMemberOptions } from '../../server/contacts-crm.server'
import { readJsonBody } from '../../server/request-body.server'

const routingSchema = z.object({
  kind: z.literal('routing'),
  strategy: z.enum(['round_robin', 'least_loaded', 'manual']),
  maxOpenConversations: z.number().int().min(1).max(500),
  businessHours: z.object({
    timezone: z.string().trim().min(3).max(80),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
})

const requestSchema = z.discriminatedUnion('kind', [
  updateAttendantSchema.extend({ kind: z.literal('availability') }),
  routingSchema,
])

export const Route = createFileRoute('/api/team')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [members, availabilityResult, settingsResult, openResult] =
            await Promise.all([
              workspaceMemberOptions({
                admin: context.admin,
                workspaceId: context.workspaceId,
              }),
              context.admin
                .from('attendant_availability')
                .select(
                  'user_id,is_available,capacity,schedule,last_heartbeat_at,updated_at',
                )
                .eq('workspace_id', context.workspaceId),
              context.admin
                .from('workspace_runtime_settings')
                .select(
                  'routing_strategy,max_open_conversations,business_hours',
                )
                .eq('workspace_id', context.workspaceId)
                .maybeSingle(),
              context.admin
                .from('conversations')
                .select('assigned_to')
                .eq('workspace_id', context.workspaceId)
                .in('status', ['open', 'pending'])
                .not('assigned_to', 'is', null),
            ])
          for (const result of [availabilityResult, settingsResult, openResult])
            if (result.error) throw result.error
          const availability = new Map(
            (availabilityResult.data ?? []).map((row) => [row.user_id, row]),
          )
          const openCounts = new Map<string, number>()
          for (const conversation of openResult.data ?? [])
            if (conversation.assigned_to)
              openCounts.set(
                conversation.assigned_to,
                (openCounts.get(conversation.assigned_to) ?? 0) + 1,
              )
          return Response.json(
            {
              members: members.map((member) => ({
                ...member,
                isCurrentUser: member.id === context.user.id,
                availability: availability.get(member.id) ?? {
                  user_id: member.id,
                  is_available: false,
                  capacity: 5,
                  schedule: {},
                  last_heartbeat_at: null,
                  updated_at: null,
                },
                openConversations: openCounts.get(member.id) ?? 0,
              })),
              routing: settingsResult.data ?? {
                routing_strategy: 'round_robin',
                max_open_conversations: 20,
                business_hours: {
                  timezone: 'America/Sao_Paulo',
                  weekdays: [1, 2, 3, 4, 5],
                  start: '08:00',
                  end: '18:00',
                },
              },
              permissions: {
                canManage: context.role === 'owner' || context.role === 'admin',
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar a equipe.')
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
          const input = requestSchema.parse(await readJsonBody(request))
          if (input.kind === 'routing') {
            if (context.role === 'agent')
              throw new ApiError(403, 'Apenas gestores alteram a distribuição.')
            const { error } = await context.admin
              .from('workspace_runtime_settings')
              .upsert({
                workspace_id: context.workspaceId,
                routing_strategy: input.strategy,
                max_open_conversations: input.maxOpenConversations,
                business_hours: input.businessHours,
              })
            if (error) throw error
            await writeCrmAudit({
              admin: context.admin,
              workspaceId: context.workspaceId,
              user: context.user,
              action: 'routing_updated',
              resourceType: 'workspace_routing',
              changes: input,
              request,
            })
            return Response.json({ ok: true })
          }

          if (context.role === 'agent' && input.userId !== context.user.id)
            throw new ApiError(
              403,
              'Você só pode alterar sua própria disponibilidade.',
            )
          const { count, error: memberError } = await context.admin
            .from('workspace_members')
            .select('user_id', { count: 'exact', head: true })
            .eq('workspace_id', context.workspaceId)
            .eq('user_id', input.userId)
          if (memberError) throw memberError
          if (!count) throw new ApiError(404, 'Membro não encontrado.')
          const { error } = await context.admin
            .from('attendant_availability')
            .upsert(
              {
                workspace_id: context.workspaceId,
                user_id: input.userId,
                is_available: input.isAvailable,
                capacity: input.capacity,
                last_heartbeat_at:
                  input.userId === context.user.id
                    ? new Date().toISOString()
                    : undefined,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'workspace_id,user_id' },
            )
          if (error) throw error
          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action: 'availability_updated',
            resourceType: 'attendant_availability',
            changes: {
              userId: input.userId,
              isAvailable: input.isAvailable,
              capacity: input.capacity,
            },
            request,
          })
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar a equipe.')
        }
      },
    },
  },
})
