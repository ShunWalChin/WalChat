/** Edição otimista, publicação atômica e auditoria de uma automação. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { automationGraphChecksum } from '../../../server/automation-engine.server'
import type { AutomationGraph } from '../../../server/automation-graph'
import {
  automationGraphSchema,
  isAutomationFieldValue,
  validateAutomationGraph,
} from '../../../server/automation-graph'
import { assertRateLimit } from '../../../server/rate-limit.server'
import { readJsonBody } from '../../../server/request-body.server'

const flowIdSchema = z.uuid()
const updateSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(1_000).nullable().optional(),
    graph: automationGraphSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.graph !== undefined,
    { message: 'Nenhuma alteração informada.' },
  )
const publishSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict()
const archiveSchema = publishSchema

export const Route = createFileRoute('/api/automations/$flowId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const flowId = flowIdSchema.parse(params.flowId)
          const [
            { data: flow, error },
            { data: versions, error: versionsError },
            { data: executions, error: executionsError },
          ] = await Promise.all([
            context.supabase
              .from('automation_flows')
              .select(
                'id,name,description,status,draft_graph,current_version,current_version_id,revision,created_at,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .eq('id', flowId)
              .maybeSingle(),
            context.supabase
              .from('automation_flow_versions')
              .select('id,version,checksum,published_at,published_by')
              .eq('workspace_id', context.workspaceId)
              .eq('flow_id', flowId)
              .order('version', { ascending: false })
              .limit(20),
            context.supabase
              .from('automation_executions')
              .select(
                'id,contact_id,status,current_node_id,steps_count,next_wake_at,last_error_code,started_at,completed_at,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .eq('flow_id', flowId)
              .order('started_at', { ascending: false })
              .limit(100),
          ])
          if (error) throw error
          if (versionsError) throw versionsError
          if (executionsError) throw executionsError
          if (!flow) throw new ApiError(404, 'Automação não encontrada.')
          return Response.json({ flow, versions, executions })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar a automação.')
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const flowId = flowIdSchema.parse(params.flowId)
          const body = updateSchema.parse(
            await readJsonBody(request, 256 * 1024),
          )
          const changes: Record<string, unknown> = {
            revision: body.expectedRevision + 1,
            updated_by: context.user.id,
          }
          if (body.name !== undefined) changes.name = body.name
          if (body.description !== undefined)
            changes.description = body.description
          if (body.graph !== undefined)
            changes.draft_graph = validateAutomationGraph(body.graph)
          const { data, error } = await context.admin
            .from('automation_flows')
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('id', flowId)
            .neq('status', 'archived')
            .eq('revision', body.expectedRevision)
            .select('id,revision,status')
            .maybeSingle()
          if (error) throw error
          if (!data)
            throw new ApiError(
              409,
              'A automação mudou ou foi arquivada. Recarregue antes de salvar.',
            )
          return Response.json(data)
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar a automação.')
        }
      },
      POST: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'automation-publish',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 20,
            windowSeconds: 60,
          })
          const flowId = flowIdSchema.parse(params.flowId)
          const body = publishSchema.parse(await readJsonBody(request))
          const { data: flow, error: flowError } = await context.supabase
            .from('automation_flows')
            .select('id,draft_graph,revision,status')
            .eq('workspace_id', context.workspaceId)
            .eq('id', flowId)
            .maybeSingle()
          if (flowError) throw flowError
          if (!flow) throw new ApiError(404, 'Automação não encontrada.')
          if (flow.status === 'archived')
            throw new ApiError(
              409,
              'Automação arquivada não pode ser publicada.',
            )
          if (flow.revision !== body.expectedRevision)
            throw new ApiError(
              409,
              'A automação mudou. Recarregue antes de publicar.',
            )
          const graph = validateAutomationGraph(flow.draft_graph)
          await validateReferences(context, flowId, graph)
          const { data, error } = await context.admin.rpc(
            'publish_automation_flow',
            {
              target_workspace_id: context.workspaceId,
              target_flow_id: flowId,
              expected_revision: body.expectedRevision,
              graph_payload: graph,
              graph_checksum: automationGraphChecksum(graph),
              actor_user_id: context.user.id,
            },
          )
          if (error) {
            if (error.message.includes('automation_revision_conflict'))
              throw new ApiError(409, 'A automação mudou durante a publicação.')
            throw error
          }
          return Response.json({ published: data?.[0] ?? null })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao publicar a automação.')
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const flowId = flowIdSchema.parse(params.flowId)
          const body = archiveSchema.parse(await readJsonBody(request))
          const { count: activeTriggers, error: triggersError } =
            await context.admin
              .from('triggers')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('flow_id', flowId)
              .eq('is_active', true)
          if (triggersError) throw triggersError
          if (activeTriggers)
            throw new ApiError(
              409,
              'Desative os gatilhos vinculados antes de arquivar a automação.',
            )
          const { data, error } = await context.admin
            .from('automation_flows')
            .update({
              status: 'archived',
              revision: body.expectedRevision + 1,
              updated_by: context.user.id,
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', flowId)
            .eq('revision', body.expectedRevision)
            .select('id,revision')
            .maybeSingle()
          if (error) throw error
          if (!data)
            throw new ApiError(409, 'A automação mudou antes do arquivamento.')
          return Response.json({ archived: true, revision: data.revision })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao arquivar a automação.')
        }
      },
    },
  },
})

async function validateReferences(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
  currentFlowId: string,
  graph: AutomationGraph,
) {
  const tagIds = new Set<string>()
  const customKeys = new Set<string>()
  const botKeys = new Set<string>()
  const bookingPageIds = new Set<string>()
  const agentIds = new Set<string>()
  const subflowIds = new Set<string>()
  let needsN8n = false
  for (const node of graph.nodes) {
    if (node.type === 'message' && node.config.bookingPageId)
      bookingPageIds.add(node.config.bookingPageId)
    if (node.type === 'ai_reply') agentIds.add(node.config.agentId)
    if (node.type === 'subflow') {
      if (node.config.flowId === currentFlowId)
        throw new ApiError(422, 'Um fluxo não pode chamar a si próprio.')
      subflowIds.add(node.config.flowId)
    }
    if (node.type === 'n8n_event') needsN8n = true
    if (node.type !== 'action') continue
    for (const action of node.config.actions) {
      if (action.type === 'add_tag' || action.type === 'remove_tag')
        tagIds.add(action.tagId)
      if (
        action.type === 'set_custom_field' ||
        action.type === 'clear_custom_field'
      )
        customKeys.add(action.fieldKey)
      if (action.type === 'set_bot_field') botKeys.add(action.fieldKey)
    }
  }
  for (const node of graph.nodes) {
    if (node.type !== 'condition') continue
    if (node.config.source === 'custom') customKeys.add(node.config.field)
    if (node.config.source === 'bot') botKeys.add(node.config.field)
  }

  const [tags, customFields, botFields, bookingPages, agents, subflows, n8n] =
    await Promise.all([
      fetchIds(context, 'tags', 'id', [...tagIds]),
      fetchFieldTypes(context, 'custom_field_definitions', [...customKeys]),
      fetchFieldTypes(context, 'automation_bot_fields', [...botKeys]),
      fetchIds(context, 'booking_pages', 'id', [...bookingPageIds]),
      fetchIds(context, 'ai_agents', 'id', [...agentIds]),
      fetchPublishedFlows(context, [...subflowIds]),
      needsN8n ? fetchConnectedN8n(context) : Promise.resolve(true),
    ])
  if (tags.size !== tagIds.size)
    throw new ApiError(422, 'Uma tag do fluxo não existe.')
  if (customFields.size !== customKeys.size)
    throw new ApiError(
      422,
      'Um campo personalizado do fluxo não existe ou está inativo.',
    )
  if (botFields.size !== botKeys.size)
    throw new ApiError(
      422,
      'Um campo global do fluxo não existe ou está inativo.',
    )
  if (bookingPages.size !== bookingPageIds.size)
    throw new ApiError(422, 'Uma agenda do fluxo não existe ou está inativa.')
  if (agents.size !== agentIds.size)
    throw new ApiError(
      422,
      'Um agente de IA do fluxo não existe ou está inativo.',
    )
  if (subflows.size !== subflowIds.size)
    throw new ApiError(422, 'Um subfluxo não existe ou não está publicado.')
  if (!n8n)
    throw new ApiError(
      422,
      'Conecte e valide o n8n antes de publicar este fluxo.',
    )
  for (const node of graph.nodes) {
    if (node.type !== 'action') continue
    for (const action of node.config.actions) {
      const type =
        action.type === 'set_custom_field'
          ? customFields.get(action.fieldKey)
          : action.type === 'set_bot_field'
            ? botFields.get(action.fieldKey)
            : null
      if (
        type &&
        'value' in action &&
        !isAutomationFieldValue(type, action.value)
      )
        throw new ApiError(
          422,
          `Valor incompatível com o tipo do campo ${action.fieldKey}.`,
        )
    }
  }
}

async function fetchPublishedFlows(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
  values: string[],
) {
  if (!values.length) return new Set<string>()
  const { data, error } = await context.admin
    .from('automation_flows')
    .select('id')
    .eq('workspace_id', context.workspaceId)
    .eq('status', 'published')
    .in('id', values)
  if (error) throw error
  return new Set(data.map((row) => row.id))
}

async function fetchConnectedN8n(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
) {
  const { count, error } = await context.admin
    .from('integration_connections')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', context.workspaceId)
    .eq('provider', 'n8n')
    .eq('status', 'connected')
    .contains('event_subscriptions', ['automation.node'])
  if (error) throw error
  return Boolean(count)
}

async function fetchFieldTypes(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
  table: 'custom_field_definitions' | 'automation_bot_fields',
  values: string[],
) {
  if (!values.length) return new Map<string, string>()
  const { data, error } = await context.admin
    .from(table)
    .select('field_key,field_type')
    .eq('workspace_id', context.workspaceId)
    .eq('is_active', true)
    .in('field_key', values)
  if (error) throw error
  return new Map(
    data.map((row) => [String(row.field_key), String(row.field_type)]),
  )
}

async function fetchIds(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
  table: string,
  column: string,
  values: string[],
) {
  if (!values.length) return new Set<string>()
  let query = context.admin
    .from(table)
    .select(column)
    .eq('workspace_id', context.workspaceId)
    .in(column, values)
  if (table === 'tags') query = query.is('archived_at', null)
  else query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw error
  return new Set(
    data.map((row) =>
      String(Object.values(row as unknown as Record<string, unknown>)[0]),
    ),
  )
}
