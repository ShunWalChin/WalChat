/** Orquestrador persistente do DAG; efeitos externos continuam no gateway do scheduler. */
import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import type {
  AutomationAction,
  AutomationGraph,
  AutomationVariables,
} from './automation-graph'
import {
  automationNextNode,
  automationNode,
  evaluateAutomationCondition,
  renderAutomationTemplate,
  selectAutomationBranch,
  validateAutomationGraph,
} from './automation-graph'
import { getSupabaseAdmin } from './supabase-admin.server'

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>

export type StartAutomationInput = {
  workspaceId: string
  flowId: string
  contactId: string
  platform: 'instagram' | 'whatsapp'
  idempotencyKey: string
  triggerId?: string | null
  sourceInteractionId?: string | null
  context?: Record<string, unknown>
}

export function automationGraphChecksum(graph: AutomationGraph) {
  return createHash('sha256').update(JSON.stringify(graph)).digest('hex')
}

/** Cria execução idempotente e agenda somente a interpretação do primeiro nó. */
export async function startAutomationExecution(
  input: StartAutomationInput,
  client = getSupabaseAdmin(),
) {
  if (!client) throw new Error('automation_supabase_unavailable')
  const { data: flow, error: flowError } = await client
    .from('automation_flows')
    .select('id,status,current_version_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.flowId)
    .maybeSingle()
  if (flowError) throw flowError
  if (!flow || flow.status !== 'published' || !flow.current_version_id)
    throw new Error('automation_flow_not_published')

  const { data: version, error: versionError } = await client
    .from('automation_flow_versions')
    .select('id,graph')
    .eq('workspace_id', input.workspaceId)
    .eq('id', flow.current_version_id)
    .single()
  if (versionError) throw versionError
  const graph = validateAutomationGraph(version.graph)

  const { data: inserted, error: insertError } = await client
    .from('automation_executions')
    .insert({
      workspace_id: input.workspaceId,
      flow_id: flow.id,
      flow_version_id: version.id,
      trigger_id: input.triggerId ?? null,
      contact_id: input.contactId,
      source_interaction_id: input.sourceInteractionId ?? null,
      platform: input.platform,
      status: 'scheduled',
      current_node_id: graph.entryNodeId,
      context: input.context ?? {},
      idempotency_key: input.idempotencyKey,
    })
    .select('id,status,current_node_id,steps_count')
    .maybeSingle()
  if (insertError && insertError.code !== '23505') throw insertError

  const execution = inserted
    ? inserted
    : await existingExecution(client, input.workspaceId, input.idempotencyKey)
  if (!inserted) {
    if (
      execution.status === 'scheduled' &&
      Number(execution.steps_count) === 0
    ) {
      const repairedJob = await scheduleAutomationJob(client, {
        workspaceId: input.workspaceId,
        executionId: execution.id,
        nodeId: execution.current_node_id ?? graph.entryNodeId,
        runAt: new Date().toISOString(),
        dedupeKey: `flow:${execution.id}:entry:${graph.entryNodeId}`,
      })
      return {
        executionId: execution.id,
        jobId: repairedJob.id,
        duplicate: true,
      }
    }
    return { executionId: execution.id, jobId: null, duplicate: true }
  }

  const job = await scheduleAutomationJob(client, {
    workspaceId: input.workspaceId,
    executionId: execution.id,
    nodeId: graph.entryNodeId,
    runAt: new Date().toISOString(),
    dedupeKey: `flow:${execution.id}:entry:${graph.entryNodeId}`,
  })
  return { executionId: execution.id, jobId: job.id, duplicate: false }
}

/** Interpreta nós síncronos até uma fronteira persistente: mensagem, delay ou fim. */
export async function processAutomationStep(
  job: {
    id: string
    workspace_id: string
    payload: Record<string, unknown>
  },
  client = getSupabaseAdmin(),
) {
  if (!client) throw new Error('automation_supabase_unavailable')
  const executionId = String(job.payload.flowExecutionId ?? '')
  if (!executionId) throw new Error('automation_execution_missing')
  const { data: execution, error: executionError } = await client
    .from('automation_executions')
    .select(
      'id,workspace_id,flow_id,flow_version_id,contact_id,platform,status,current_node_id,context,steps_count',
    )
    .eq('workspace_id', job.workspace_id)
    .eq('id', executionId)
    .single()
  if (executionError) throw executionError
  if (
    ['completed', 'blocked', 'failed', 'cancelled'].includes(execution.status)
  )
    return { status: execution.status }

  const [{ data: version, error: versionError }, variables] = await Promise.all(
    [
      client
        .from('automation_flow_versions')
        .select('graph')
        .eq('workspace_id', job.workspace_id)
        .eq('id', execution.flow_version_id)
        .single(),
      loadAutomationVariables(client, execution),
    ],
  )
  if (versionError) throw versionError
  const graph = validateAutomationGraph(version.graph)
  let currentNodeId = String(
    job.payload.nodeId ?? execution.current_node_id ?? graph.entryNodeId,
  )
  let stepsCount = Number(execution.steps_count ?? 0)
  await updateExecution(client, execution.id, job.workspace_id, {
    status: 'running',
    next_wake_at: null,
  })

  for (let synchronousSteps = 0; synchronousSteps < 25; synchronousSteps++) {
    if (stepsCount >= 1_000) throw new Error('automation_step_limit_reached')
    const node = automationNode(graph, currentNodeId)
    await recordStep(client, execution, node.id, node.type, 'running')

    if (node.type === 'end') {
      stepsCount++
      await recordStep(client, execution, node.id, node.type, 'completed', {
        outcome: node.config?.outcome ?? 'completed',
      })
      await updateExecution(client, execution.id, job.workspace_id, {
        status: 'completed',
        current_node_id: node.id,
        steps_count: stepsCount,
        completed_at: new Date().toISOString(),
      })
      await updateLegacyRun(
        client,
        execution.workspace_id,
        execution.context,
        'sent',
        null,
      )
      return { status: 'completed', nodeId: node.id }
    }

    if (node.type === 'message') {
      const nextNodeId = automationNextNode(graph, node.id)
      const message = renderAutomationTemplate(
        node.config.text,
        variables,
      ).trim()
      if (!message) throw new Error('automation_rendered_message_empty')
      const context = execution.context as Record<string, unknown>
      const { data: messageJob, error: messageJobError } = await client
        .from('scheduled_jobs')
        .upsert(
          {
            workspace_id: job.workspace_id,
            kind: 'sequence_step',
            dedupe_key: `flow:${execution.id}:message:${node.id}`,
            payload: {
              platform: execution.platform,
              contactId: execution.contact_id,
              responseText: message,
              bookingPageId: node.config.bookingPageId ?? null,
              senderId: context.senderId ?? null,
              instagramCommentId: context.instagramCommentId ?? null,
              commentCreatedAt: context.commentCreatedAt ?? null,
              automationRunId: context.automationRunId ?? null,
              flowExecutionId: execution.id,
              flowNodeId: node.id,
              flowNextNodeId: nextNodeId,
            },
            run_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,dedupe_key' },
        )
        .select('id')
        .single()
      if (messageJobError) throw messageJobError
      stepsCount++
      await recordStep(client, execution, node.id, node.type, 'scheduled', {
        scheduledJobId: messageJob.id,
        characters: message.length,
      })
      await updateExecution(client, execution.id, job.workspace_id, {
        status: 'scheduled',
        current_node_id: node.id,
        steps_count: stepsCount,
      })
      return { status: 'scheduled', nodeId: node.id, jobId: messageJob.id }
    }

    if (node.type === 'delay') {
      const nextNodeId = automationNextNode(graph, node.id)
      const runAt = new Date(
        Date.now() + node.config.seconds * 1_000,
      ).toISOString()
      const nextJob = await scheduleAutomationJob(client, {
        workspaceId: job.workspace_id,
        executionId: execution.id,
        nodeId: nextNodeId,
        runAt,
        dedupeKey: `flow:${execution.id}:delay:${node.id}`,
      })
      stepsCount++
      await recordStep(client, execution, node.id, node.type, 'completed', {
        delaySeconds: node.config.seconds,
        nextWakeAt: runAt,
      })
      await updateExecution(client, execution.id, job.workspace_id, {
        status: 'waiting',
        current_node_id: nextNodeId,
        steps_count: stepsCount,
        next_wake_at: runAt,
      })
      return { status: 'waiting', nodeId: node.id, jobId: nextJob.id }
    }

    let branch = 'default'
    if (node.type === 'condition')
      branch = evaluateAutomationCondition(node.config, variables)
        ? 'true'
        : 'false'
    if (node.type === 'random_split')
      branch = selectAutomationBranch(node, `${execution.id}:${node.id}`)
    if (node.type === 'action') {
      const { error } = await client.rpc('apply_automation_actions', {
        target_workspace_id: job.workspace_id,
        target_execution_id: execution.id,
        target_contact_id: execution.contact_id,
        actions_payload: node.config.actions,
      })
      if (error) throw error
      applyActionsLocally(variables, node.config.actions)
    }

    const nextNodeId = automationNextNode(graph, node.id, branch)
    stepsCount++
    await recordStep(client, execution, node.id, node.type, 'completed', {
      branch,
      actionCount:
        node.type === 'action' ? node.config.actions.length : undefined,
    })
    await updateExecution(client, execution.id, job.workspace_id, {
      status: 'running',
      current_node_id: nextNodeId,
      steps_count: stepsCount,
    })
    currentNodeId = nextNodeId
  }

  const continuation = await scheduleAutomationJob(client, {
    workspaceId: job.workspace_id,
    executionId: execution.id,
    nodeId: currentNodeId,
    runAt: new Date().toISOString(),
    dedupeKey: `flow:${execution.id}:continuation:${stepsCount}`,
  })
  await updateExecution(client, execution.id, job.workspace_id, {
    status: 'scheduled',
    current_node_id: currentNodeId,
    steps_count: stepsCount,
  })
  return { status: 'scheduled', nodeId: currentNodeId, jobId: continuation.id }
}

/** Só retoma o DAG depois que o dispatcher persistiu a decisão de compliance. */
export async function resumeAutomationAfterMessage(
  input: {
    workspaceId: string
    executionId: string
    nodeId: string
    nextNodeId: string
    sent: boolean
    privateReply: boolean
    reason?: string | null
    policy?: string | null
  },
  client = getSupabaseAdmin(),
) {
  if (!client) throw new Error('automation_supabase_unavailable')
  const terminalStatus = input.sent ? 'completed' : 'blocked'
  const { error: stepError } = await client
    .from('automation_execution_steps')
    .update({
      status: terminalStatus,
      output_summary: {
        sent: input.sent,
        policy: input.policy ?? null,
        privateReply: input.privateReply,
      },
      error_code: input.sent ? null : (input.reason ?? 'delivery_blocked'),
      completed_at: new Date().toISOString(),
    })
    .eq('workspace_id', input.workspaceId)
    .eq('execution_id', input.executionId)
    .eq('node_id', input.nodeId)
    .eq('attempt', 1)
  if (stepError) throw stepError

  if (!input.sent || input.privateReply) {
    await updateExecution(client, input.executionId, input.workspaceId, {
      status: terminalStatus,
      current_node_id: input.nodeId,
      last_error_code: input.sent ? null : (input.reason ?? 'delivery_blocked'),
      completed_at: new Date().toISOString(),
    })
    return { status: terminalStatus }
  }

  const job = await scheduleAutomationJob(client, {
    workspaceId: input.workspaceId,
    executionId: input.executionId,
    nodeId: input.nextNodeId,
    runAt: new Date().toISOString(),
    dedupeKey: `flow:${input.executionId}:after:${input.nodeId}`,
  })
  await updateExecution(client, input.executionId, input.workspaceId, {
    status: 'scheduled',
    current_node_id: input.nextNodeId,
    last_error_code: null,
  })
  return { status: 'scheduled', jobId: job.id }
}

export async function markAutomationExecutionFailure(
  input: {
    workspaceId: string
    executionId: string
    terminal: boolean
    errorCode: string
  },
  client = getSupabaseAdmin(),
) {
  if (!client) return
  await updateExecution(client, input.executionId, input.workspaceId, {
    status: input.terminal ? 'failed' : 'scheduled',
    last_error_code: input.errorCode.slice(0, 120),
    completed_at: input.terminal ? new Date().toISOString() : null,
  })
}

async function existingExecution(
  client: AdminClient,
  workspaceId: string,
  idempotencyKey: string,
) {
  const { data, error } = await client
    .from('automation_executions')
    .select('id,status,current_node_id,steps_count')
    .eq('workspace_id', workspaceId)
    .eq('idempotency_key', idempotencyKey)
    .single()
  if (error) throw error
  return data
}

async function scheduleAutomationJob(
  client: AdminClient,
  input: {
    workspaceId: string
    executionId: string
    nodeId: string
    runAt: string
    dedupeKey: string
  },
) {
  const { data, error } = await client
    .from('scheduled_jobs')
    .upsert(
      {
        workspace_id: input.workspaceId,
        kind: 'automation_step',
        dedupe_key: input.dedupeKey,
        payload: {
          flowExecutionId: input.executionId,
          nodeId: input.nodeId,
        },
        run_at: input.runAt,
      },
      { onConflict: 'workspace_id,dedupe_key' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data
}

async function loadAutomationVariables(
  client: AdminClient,
  execution: {
    workspace_id: string
    contact_id: string
    context: unknown
  },
): Promise<AutomationVariables> {
  const [
    { data: contact, error: contactError },
    { data: bot, error: botError },
  ] = await Promise.all([
    client
      .from('contacts')
      .select(
        'id,username,full_name,display_name,email,phone,company,job_title,city,state,country_code,language,timezone,lifecycle_stage,lead_score,last_inbound_at,last_interaction_at,custom_fields',
      )
      .eq('workspace_id', execution.workspace_id)
      .eq('id', execution.contact_id)
      .single(),
    client
      .from('automation_bot_fields')
      .select('field_key,value')
      .eq('workspace_id', execution.workspace_id)
      .eq('is_active', true),
  ])
  if (contactError) throw contactError
  if (botError) throw botError
  return {
    contact,
    custom: (contact.custom_fields ?? {}) as Record<string, unknown>,
    bot: Object.fromEntries(bot.map((field) => [field.field_key, field.value])),
    context: (execution.context ?? {}) as Record<string, unknown>,
  }
}

function applyActionsLocally(
  variables: AutomationVariables,
  actions: AutomationAction[],
) {
  for (const action of actions) {
    if (action.type === 'set_custom_field')
      variables.custom[action.fieldKey] = action.value
    if (action.type === 'clear_custom_field')
      delete variables.custom[action.fieldKey]
    if (action.type === 'set_bot_field')
      variables.bot[action.fieldKey] = action.value
  }
}

async function recordStep(
  client: AdminClient,
  execution: { id: string; workspace_id: string },
  nodeId: string,
  nodeType: string,
  status: 'running' | 'scheduled' | 'completed' | 'blocked' | 'failed',
  output: Record<string, unknown> = {},
) {
  const cleanOutput = Object.fromEntries(
    Object.entries(output).filter(([, value]) => value !== undefined),
  )
  const { error } = await client.from('automation_execution_steps').upsert(
    {
      workspace_id: execution.workspace_id,
      execution_id: execution.id,
      node_id: nodeId,
      node_type: nodeType,
      status,
      attempt: 1,
      output_summary: cleanOutput,
      completed_at:
        status === 'completed' || status === 'blocked' || status === 'failed'
          ? new Date().toISOString()
          : null,
    },
    { onConflict: 'execution_id,node_id,attempt' },
  )
  if (error) throw error
}

async function updateExecution(
  client: AdminClient,
  executionId: string,
  workspaceId: string,
  changes: Record<string, unknown>,
) {
  const { error } = await client
    .from('automation_executions')
    .update(changes)
    .eq('id', executionId)
    .eq('workspace_id', workspaceId)
  if (error) throw error
}

async function updateLegacyRun(
  client: AdminClient,
  workspaceId: string,
  context: unknown,
  status: 'sent' | 'blocked' | 'failed',
  reason: string | null,
) {
  const automationRunId =
    context && typeof context === 'object' && 'automationRunId' in context
      ? String((context as Record<string, unknown>).automationRunId ?? '')
      : ''
  if (!automationRunId) return
  const { error } = await client
    .from('automation_runs')
    .update({ status, reason })
    .eq('id', automationRunId)
    .eq('workspace_id', workspaceId)
  if (error) throw error
}
