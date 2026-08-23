/** Catálogo e criação de automações DAG do workspace autenticado. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import {
  automationGraphSchema,
  defaultAutomationGraph,
  validateAutomationGraph,
} from '../../server/automation-graph'
import { assertRateLimit } from '../../server/rate-limit.server'
import { readJsonBody } from '../../server/request-body.server'

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(1_000).nullable().optional(),
    graph: automationGraphSchema.optional(),
  })
  .strict()

export const Route = createFileRoute('/api/automations')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [
            { data: flows, error },
            { data: executions, error: runsError },
          ] = await Promise.all([
            context.supabase
              .from('automation_flows')
              .select(
                'id,name,description,status,current_version,revision,updated_at,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('updated_at', { ascending: false }),
            context.supabase
              .from('automation_executions')
              .select('flow_id,status')
              .eq('workspace_id', context.workspaceId)
              .order('updated_at', { ascending: false })
              .limit(2_000),
          ])
          if (error) throw error
          if (runsError) throw runsError
          const metrics = new Map<
            string,
            { total: number; active: number; failed: number; completed: number }
          >()
          for (const execution of executions) {
            const current = metrics.get(execution.flow_id) ?? {
              total: 0,
              active: 0,
              failed: 0,
              completed: 0,
            }
            current.total++
            if (['scheduled', 'running', 'waiting'].includes(execution.status))
              current.active++
            if (['failed', 'blocked'].includes(execution.status))
              current.failed++
            if (execution.status === 'completed') current.completed++
            metrics.set(execution.flow_id, current)
          }
          return Response.json({
            flows: flows.map((flow) => ({
              ...flow,
              metrics: metrics.get(flow.id) ?? {
                total: 0,
                active: 0,
                failed: 0,
                completed: 0,
              },
            })),
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar automações.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'automation-create',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 30,
            windowSeconds: 60,
          })
          const body = createSchema.parse(
            await readJsonBody(request, 256 * 1024),
          )
          const graph = validateAutomationGraph(
            body.graph ?? defaultAutomationGraph(),
          )
          const { data, error } = await context.admin
            .from('automation_flows')
            .insert({
              workspace_id: context.workspaceId,
              name: body.name,
              description: body.description ?? null,
              draft_graph: graph,
              created_by: context.user.id,
              updated_by: context.user.id,
            })
            .select('id,revision')
            .single()
          if (error) throw error
          return Response.json(data, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar a automação.')
        }
      },
    },
  },
})
