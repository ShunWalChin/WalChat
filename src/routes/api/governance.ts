/** Governança de IA: orçamento, versões, roteamento, memória, casos e uso. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { writeCrmAudit } from '../../server/crm-pipeline.server'
import { workspaceMemberOptions } from '../../server/contacts-crm.server'
import { readJsonBody } from '../../server/request-body.server'

const nullableUuid = z.union([z.uuid(), z.null()]).optional()
const createSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('budget'),
    monthlyTokenLimit: z.number().int().min(0).max(10_000_000_000),
    warningPercent: z.number().int().min(1).max(100),
    hardStop: z.boolean(),
  }),
  z.object({
    kind: z.literal('memory'),
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_.-]{1,79}$/),
    value: z.string().trim().min(1).max(4000),
    source: z.string().trim().min(2).max(60).default('manual'),
  }),
  z.object({
    kind: z.literal('case'),
    title: z.string().trim().min(2).max(180),
    reason: z.string().trim().min(2).max(120),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    agentId: nullableUuid,
    contactId: nullableUuid,
    conversationId: nullableUuid,
  }),
  z.object({
    kind: z.literal('router'),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    strategy: z.enum(['intent', 'priority', 'fallback']).default('intent'),
    fallbackAgentId: nullableUuid,
  }),
  z.object({
    kind: z.literal('version'),
    agentId: z.uuid(),
    changeSummary: z.string().trim().min(2).max(500),
  }),
])

const patchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('memory_status'),
    id: z.uuid(),
    active: z.boolean(),
  }),
  z.object({
    kind: z.literal('router_status'),
    id: z.uuid(),
    active: z.boolean(),
  }),
  z.object({
    kind: z.literal('case_status'),
    id: z.uuid(),
    status: z.enum(['open', 'in_progress', 'resolved', 'dismissed']),
    assignedTo: nullableUuid,
  }),
])

function monthStartIso() {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString()
}

export const Route = createFileRoute('/api/governance')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const since = monthStartIso()
          const [
            budgetResult,
            agentsResult,
            versionsResult,
            routersResult,
            routerMembersResult,
            memoryResult,
            casesResult,
            executionsResult,
            providerResult,
            members,
          ] = await Promise.all([
            context.admin
              .from('ai_budgets')
              .select(
                'monthly_token_limit,monthly_limit_cents,warning_percent,hard_stop,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .maybeSingle(),
            context.admin
              .from('ai_agents')
              .select(
                'id,name,persona,tone,mode,is_active,provider_override,model_override,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('name'),
            context.admin
              .from('ai_agent_versions')
              .select(
                'id,agent_id,version,change_summary,status,created_at,published_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at', { ascending: false })
              .limit(50),
            context.admin
              .from('ai_routers')
              .select(
                'id,name,description,strategy,is_active,fallback_agent_id,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('name'),
            context.admin
              .from('ai_router_members')
              .select('router_id,agent_id,intent,priority,examples')
              .eq('workspace_id', context.workspaceId)
              .order('priority'),
            context.admin
              .from('org_memory_entries')
              .select(
                'id,memory_key,value,source,is_active,created_at,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('updated_at', { ascending: false })
              .limit(100),
            context.admin
              .from('agent_cases')
              .select(
                'id,agent_id,contact_id,conversation_id,title,reason,priority,status,assigned_to,summary,created_at,updated_at,resolved_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at', { ascending: false })
              .limit(100),
            context.admin
              .from('ai_execution_log')
              .select(
                'id,agent_id,provider,model,purpose,status,input_tokens,output_tokens,cost_cents,latency_ms,error_code,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(500),
            context.admin
              .from('ai_provider_settings')
              .select('provider,model,is_enabled,updated_at')
              .eq('workspace_id', context.workspaceId)
              .maybeSingle(),
            workspaceMemberOptions({
              admin: context.admin,
              workspaceId: context.workspaceId,
            }),
          ])
          for (const result of [
            budgetResult,
            agentsResult,
            versionsResult,
            routersResult,
            routerMembersResult,
            memoryResult,
            casesResult,
            executionsResult,
            providerResult,
          ])
            if (result.error) throw result.error
          const executions = executionsResult.data ?? []
          const agents = agentsResult.data ?? []
          const versions = versionsResult.data ?? []
          const routers = routersResult.data ?? []
          const routerMembers = routerMembersResult.data ?? []
          const memory = memoryResult.data ?? []
          const cases = casesResult.data ?? []
          const tokensUsed = executions.reduce(
            (total, execution) =>
              total +
              Number(execution.input_tokens ?? 0) +
              Number(execution.output_tokens ?? 0),
            0,
          )
          const completed = executions.filter(
            (execution) => execution.status === 'completed',
          )
          const agentNames = new Map(
            agents.map((agent) => [agent.id, agent.name]),
          )
          const memberNames = new Map(
            members.map((member) => [member.id, member.name]),
          )
          const monthlyTokenLimit = Number(
            budgetResult.data?.monthly_token_limit ?? 0,
          )
          return Response.json(
            {
              provider: providerResult.data,
              budget: {
                monthlyTokenLimit,
                monthlyLimitCents: Number(
                  budgetResult.data?.monthly_limit_cents ?? 0,
                ),
                warningPercent: budgetResult.data?.warning_percent ?? 80,
                hardStop: budgetResult.data?.hard_stop ?? true,
                tokensUsed,
                percentUsed: monthlyTokenLimit
                  ? Math.min(100, (tokensUsed / monthlyTokenLimit) * 100)
                  : 0,
              },
              summary: {
                agents: agents.length,
                activeAgents: agents.filter((agent) => agent.is_active).length,
                openCases: cases.filter((item) =>
                  ['open', 'in_progress'].includes(item.status),
                ).length,
                executions: executions.length,
                successRate: executions.length
                  ? Math.round((completed.length / executions.length) * 100)
                  : 0,
                averageLatencyMs: completed.length
                  ? Math.round(
                      completed.reduce(
                        (total, item) => total + Number(item.latency_ms ?? 0),
                        0,
                      ) / completed.length,
                    )
                  : 0,
              },
              agents,
              versions: versions.map((version) => ({
                ...version,
                agentName: agentNames.get(version.agent_id) ?? 'Agente',
              })),
              routers: routers.map((router) => ({
                ...router,
                members: routerMembers.filter(
                  (member) => member.router_id === router.id,
                ),
              })),
              memory,
              cases: cases.map((item) => ({
                ...item,
                agentName: item.agent_id
                  ? (agentNames.get(item.agent_id) ?? 'Agente')
                  : null,
                assignedName: item.assigned_to
                  ? (memberNames.get(item.assigned_to) ?? 'Membro')
                  : null,
              })),
              executions: executions.slice(0, 100).map((execution) => ({
                ...execution,
                agentName: execution.agent_id
                  ? (agentNames.get(execution.agent_id) ?? 'Agente')
                  : null,
              })),
              members,
              permissions: {
                canManage: context.role === 'owner' || context.role === 'admin',
                canOperate: context.role !== 'viewer',
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao consultar a governança de IA.',
          )
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
          const input = createSchema.parse(await readJsonBody(request))
          const managerOnly = [
            'budget',
            'memory',
            'router',
            'version',
          ].includes(input.kind)
          if (managerOnly && context.role === 'agent')
            throw new ApiError(
              403,
              'Apenas gestores alteram esta configuração.',
            )

          let resourceId: string | null = null
          if (input.kind === 'budget') {
            const { error } = await context.admin.from('ai_budgets').upsert({
              workspace_id: context.workspaceId,
              monthly_token_limit: input.monthlyTokenLimit,
              warning_percent: input.warningPercent,
              hard_stop: input.hardStop,
              updated_by_user_id: context.user.id,
              updated_at: new Date().toISOString(),
            })
            if (error) throw error
          } else if (input.kind === 'memory') {
            const { data, error } = await context.admin
              .from('org_memory_entries')
              .upsert(
                {
                  workspace_id: context.workspaceId,
                  memory_key: input.key,
                  value: input.value,
                  source: input.source,
                  is_active: true,
                  created_by_user_id: context.user.id,
                },
                { onConflict: 'workspace_id,memory_key' },
              )
              .select('id')
              .single()
            if (error) throw error
            resourceId = data.id
          } else if (input.kind === 'case') {
            const { data, error } = await context.admin
              .from('agent_cases')
              .insert({
                workspace_id: context.workspaceId,
                title: input.title,
                reason: input.reason,
                priority: input.priority,
                agent_id: input.agentId ?? null,
                contact_id: input.contactId ?? null,
                conversation_id: input.conversationId ?? null,
              })
              .select('id')
              .single()
            if (error) throw error
            resourceId = data.id
            await context.admin.from('agent_case_events').insert({
              workspace_id: context.workspaceId,
              case_id: data.id,
              event_type: 'case_opened',
              payload: { reason: input.reason, priority: input.priority },
              actor_user_id: context.user.id,
            })
          } else if (input.kind === 'router') {
            const { data, error } = await context.admin
              .from('ai_routers')
              .insert({
                workspace_id: context.workspaceId,
                name: input.name,
                description: input.description || null,
                strategy: input.strategy,
                fallback_agent_id: input.fallbackAgentId ?? null,
              })
              .select('id')
              .single()
            if (error?.code === '23505')
              throw new ApiError(409, 'Já existe um roteador com este nome.')
            if (error) throw error
            resourceId = data.id
          } else {
            const { data: agent, error: agentError } = await context.admin
              .from('ai_agents')
              .select(
                'id,name,persona,tone,mode,temperature,is_active,provider_override,model_override,max_reply_chars,fallback_to_copilot',
              )
              .eq('workspace_id', context.workspaceId)
              .eq('id', input.agentId)
              .maybeSingle()
            if (agentError) throw agentError
            if (!agent) throw new ApiError(404, 'Agente não encontrado.')
            const { data: latest, error: latestError } = await context.admin
              .from('ai_agent_versions')
              .select('version')
              .eq('workspace_id', context.workspaceId)
              .eq('agent_id', input.agentId)
              .order('version', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (latestError) throw latestError
            const { data, error } = await context.admin
              .from('ai_agent_versions')
              .insert({
                workspace_id: context.workspaceId,
                agent_id: input.agentId,
                version: Number(latest?.version ?? 0) + 1,
                snapshot: agent,
                change_summary: input.changeSummary,
                status: 'draft',
                created_by_user_id: context.user.id,
              })
              .select('id')
              .single()
            if (error) throw error
            resourceId = data.id
          }

          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action: `ai_${input.kind}_created_or_updated`,
            resourceType: `ai_${input.kind}`,
            resourceId,
            changes: { kind: input.kind },
            request,
          })
          return Response.json({ ok: true, id: resourceId })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao atualizar a governança de IA.',
          )
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
          const input = patchSchema.parse(await readJsonBody(request))
          if (
            ['memory_status', 'router_status'].includes(input.kind) &&
            context.role === 'agent'
          )
            throw new ApiError(
              403,
              'Apenas gestores alteram esta configuração.',
            )
          let action: string = input.kind
          if (input.kind === 'memory_status') {
            const { error } = await context.admin
              .from('org_memory_entries')
              .update({ is_active: input.active })
              .eq('workspace_id', context.workspaceId)
              .eq('id', input.id)
            if (error) throw error
          } else if (input.kind === 'router_status') {
            const { error } = await context.admin
              .from('ai_routers')
              .update({ is_active: input.active })
              .eq('workspace_id', context.workspaceId)
              .eq('id', input.id)
            if (error) throw error
          } else {
            const resolved = ['resolved', 'dismissed'].includes(input.status)
            const { error } = await context.admin
              .from('agent_cases')
              .update({
                status: input.status,
                assigned_to: input.assignedTo ?? null,
                resolved_at: resolved ? new Date().toISOString() : null,
              })
              .eq('workspace_id', context.workspaceId)
              .eq('id', input.id)
            if (error) throw error
            const { error: eventError } = await context.admin
              .from('agent_case_events')
              .insert({
                workspace_id: context.workspaceId,
                case_id: input.id,
                event_type: 'case_status_changed',
                payload: { status: input.status },
                actor_user_id: context.user.id,
              })
            if (eventError) throw eventError
            action = `case_${input.status}`
          }
          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action,
            resourceType: input.kind,
            resourceId: input.id,
            changes: input,
            request,
          })
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao alterar a governança de IA.')
        }
      },
    },
  },
})
