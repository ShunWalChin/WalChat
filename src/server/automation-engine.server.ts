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
  renderAutomationFields,
  renderAutomationTemplate,
  selectAutomationBranch,
  validateAutomationGraph,
} from './automation-graph'
import { matchChoice } from './channel-choices'
import { OutboundUrlError, assertSafeOutboundUrl } from './outbound-url'
import type { AutomationChoice } from './channel-choices'
import { USER_INPUT_REJECTION_MESSAGE, validateUserInput } from './user-input'
import { suggestInstagramReply } from './ai.server'
import { getServerEnv } from './env.server'
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
      const choices = node.config.choices ?? null
      // Com escolhas não existe "próximo nó" até o contato responder; o destino
      // sai da porta que corresponder à escolha, já na retomada.
      const nextNodeId = choices?.length
        ? node.id
        : automationNextNode(graph, node.id)
      const message = renderAutomationTemplate(
        node.config.text,
        variables,
      ).trim()
      if (!message) throw new Error('automation_rendered_message_empty')
      const messageJob = await scheduleFlowMessage(client, execution, {
        nodeId: node.id,
        nextNodeId,
        message,
        bookingPageId: node.config.bookingPageId ?? null,
        mediaUrl: node.config.mediaUrl ?? null,
        mediaType: node.config.mediaType ?? null,
        aiGenerated: false,
        choices,
        awaits: choices?.length
          ? {
              kind: 'choice',
              timeoutSeconds: node.config.awaitTimeoutSeconds ?? null,
            }
          : null,
      })
      stepsCount++
      await recordStep(client, execution, node.id, node.type, 'scheduled', {
        scheduledJobId: messageJob.id,
        characters: message.length,
        mediaType: node.config.mediaType ?? undefined,
        choices: choices?.length ?? undefined,
      })
      await updateExecution(client, execution.id, job.workspace_id, {
        status: 'scheduled',
        current_node_id: node.id,
        steps_count: stepsCount,
      })
      return { status: 'scheduled', nodeId: node.id, jobId: messageJob.id }
    }

    if (node.type === 'external_request') {
      const rendered = renderAutomationFields(
        node.config.headers.map((header) => ({
          key: header.key,
          value: header.value,
        })),
        variables,
      )
      const { outcome, payload } = await runExternalRequest({
        url: renderAutomationTemplate(node.config.url, variables),
        method: node.config.method,
        headers: Object.entries(rendered).map(([key, value]) => ({
          key,
          value: String(value),
        })),
        body: node.config.body
          ? renderAutomationTemplate(node.config.body, variables)
          : undefined,
        timeoutMs: node.config.timeoutMs,
      })

      let mapped = 0
      if (outcome.ok)
        for (const mapping of node.config.responseMapping) {
          const value = scalarFromResponse(readJsonPath(payload, mapping.path))
          if (value === null) continue
          await saveUserInputValue(client, execution, mapping.save, value)
          mapped++
        }

      const branch = outcome.ok
        ? 'default'
        : hasBranch(graph, node.id, 'error')
          ? 'error'
          : null
      // Sem porta de erro desenhada, a falha precisa aparecer como falha e não
      // seguir pelo caminho de sucesso.
      if (!branch) throw new Error('automation_external_request_failed')

      stepsCount++
      await recordStep(client, execution, node.id, node.type, 'completed', {
        status: outcome.status,
        mapped,
        errorCode: outcome.errorCode,
      })
      const nextNodeId = automationNextNode(graph, node.id, branch)
      currentNodeId = nextNodeId
      await updateExecution(client, execution.id, job.workspace_id, {
        current_node_id: nextNodeId,
        steps_count: stepsCount,
      })
      continue
    }

    if (node.type === 'user_input') {
      const prompt = renderAutomationTemplate(
        node.config.prompt,
        variables,
      ).trim()
      if (!prompt) throw new Error('automation_rendered_message_empty')
      const messageJob = await scheduleFlowMessage(client, execution, {
        nodeId: node.id,
        // A porta real depende da resposta; o próprio nó marca o lugar.
        nextNodeId: node.id,
        message: prompt,
        bookingPageId: null,
        mediaUrl: null,
        mediaType: null,
        aiGenerated: false,
        awaits: { kind: 'input', timeoutSeconds: node.config.timeoutSeconds },
      })
      stepsCount++
      await recordStep(client, execution, node.id, node.type, 'scheduled', {
        scheduledJobId: messageJob.id,
        expects: node.config.expects,
        maxAttempts: node.config.maxAttempts,
      })
      await updateExecution(client, execution.id, job.workspace_id, {
        status: 'scheduled',
        current_node_id: node.id,
        steps_count: stepsCount,
      })
      return { status: 'scheduled', nodeId: node.id, jobId: messageJob.id }
    }

    if (node.type === 'ai_reply') {
      await assertAutonomousAiEnabled(client, job.workspace_id)
      const nextNodeId = automationNextNode(graph, node.id)
      const prompt = renderAutomationTemplate(node.config.prompt, variables)
      const history = await loadAutomationHistory(
        client,
        job.workspace_id,
        execution.contact_id,
      )
      const generated = await suggestInstagramReply({
        workspaceId: job.workspace_id,
        agentId: node.config.agentId,
        history: [...history, { role: 'user', content: prompt }],
        safetyIdentifier: `${job.workspace_id}:${execution.contact_id}`,
        contactId: execution.contact_id,
      })
      if (generated.agent.mode !== 'autonomous')
        throw new Error('automation_ai_agent_requires_autonomous_mode')
      const messageJob = await scheduleFlowMessage(client, execution, {
        nodeId: node.id,
        nextNodeId,
        message: generated.suggestion,
        bookingPageId: null,
        mediaUrl: null,
        mediaType: null,
        aiGenerated: true,
      })
      stepsCount++
      await recordStep(client, execution, node.id, node.type, 'scheduled', {
        scheduledJobId: messageJob.id,
        provider: generated.provider,
        model: generated.model,
        characters: generated.suggestion.length,
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

    if (node.type === 'n8n_event') {
      const nextNodeId = automationNextNode(graph, node.id)
      const { data: integrationJob, error: integrationError } = await client
        .from('scheduled_jobs')
        .upsert(
          {
            workspace_id: job.workspace_id,
            kind: 'integration_event',
            dedupe_key: `flow:${execution.id}:n8n:${node.id}`,
            payload: {
              eventType: 'automation.node',
              deliveryId: `flow:${execution.id}:${node.id}`,
              eventData: {
                eventName: node.config.eventName,
                flowId: execution.flow_id,
                executionId: execution.id,
                contactId: execution.contact_id,
                nodeId: node.id,
                data: renderAutomationFields(node.config.fields, variables),
              },
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
      if (integrationError) throw integrationError
      stepsCount++
      await recordStep(client, execution, node.id, node.type, 'scheduled', {
        scheduledJobId: integrationJob.id,
        eventName: node.config.eventName,
      })
      await updateExecution(client, execution.id, job.workspace_id, {
        status: 'scheduled',
        current_node_id: node.id,
        steps_count: stepsCount,
      })
      return {
        status: 'scheduled',
        nodeId: node.id,
        jobId: integrationJob.id,
      }
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
    if (node.type === 'handoff') {
      const now = new Date().toISOString()
      const [
        { error: contactError },
        { data: conversations, error: inboxError },
      ] = await Promise.all([
        client
          .from('contacts')
          .update({
            ai_enabled: false,
            inbox_category: node.config.category,
          })
          .eq('workspace_id', job.workspace_id)
          .eq('id', execution.contact_id),
        client
          .from('conversations')
          .update({
            category: node.config.category,
            priority: node.config.priority,
            status: 'pending',
            last_assigned_at: now,
          })
          .eq('workspace_id', job.workspace_id)
          .eq('contact_id', execution.contact_id)
          .select('id'),
      ])
      if (contactError) throw contactError
      if (inboxError) throw inboxError
      if (node.config.note && conversations.length) {
        const { error: noteError } = await client
          .from('conversation_notes')
          .upsert(
            conversations.map((conversation) => ({
              workspace_id: job.workspace_id,
              conversation_id: conversation.id,
              body: node.config.note,
              automation_execution_id: execution.id,
              automation_node_id: node.id,
            })),
            { onConflict: 'automation_execution_id,automation_node_id' },
          )
        if (noteError) throw noteError
      }
    }
    if (node.type === 'subflow') {
      const context = execution.context as Record<string, unknown>
      const depth = Number(context.flowDepth ?? 0)
      if (depth >= 5) throw new Error('automation_subflow_depth_reached')
      if (node.config.flowId === execution.flow_id)
        throw new Error('automation_subflow_self_reference')
      await startAutomationExecution(
        {
          workspaceId: job.workspace_id,
          flowId: node.config.flowId,
          contactId: execution.contact_id,
          platform: execution.platform,
          idempotencyKey: `subflow:${execution.id}:${node.id}`,
          context: {
            ...context,
            source: 'subflow',
            parentExecutionId: execution.id,
            flowDepth: depth + 1,
          },
        },
        client,
      )
    }

    const nextNodeId = automationNextNode(graph, node.id, branch)
    stepsCount++
    await recordStep(client, execution, node.id, node.type, 'completed', {
      branch,
      actionCount:
        node.type === 'action' ? node.config.actions.length : undefined,
      handoffCategory:
        node.type === 'handoff' ? node.config.category : undefined,
      childFlowId: node.type === 'subflow' ? node.config.flowId : undefined,
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
    /** Quando presente, a execução para aqui e espera o contato responder. */
    awaits?: {
      kind: 'choice' | 'input'
      timeoutSeconds: number | null
      attempts?: number
    } | null
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

  // Pergunta e botão só fazem sentido depois que a mensagem saiu. Estacionar
  // aqui, e não antes do envio, evita esperar por uma resposta a algo que o
  // compliance bloqueou.
  if (input.awaits) {
    const until = input.awaits.timeoutSeconds
      ? new Date(Date.now() + input.awaits.timeoutSeconds * 1_000).toISOString()
      : null
    await updateExecution(client, input.executionId, input.workspaceId, {
      status: 'waiting_reply',
      current_node_id: input.nodeId,
      awaiting_kind: input.awaits.kind,
      awaiting_node_id: input.nodeId,
      awaiting_until: until,
      // Zerar aqui apagaria a tentativa que o reenvio acabou de contar, e o
      // limite de tentativas nunca seria alcançado.
      awaiting_attempts: input.awaits.attempts ?? 0,
      last_error_code: null,
    })
    if (until)
      await scheduleAwaitTimeoutJob(client, {
        workspaceId: input.workspaceId,
        executionId: input.executionId,
        nodeId: input.nodeId,
        runAt: until,
      })
    return { status: 'waiting_reply', awaitingUntil: until }
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

/** Job que acorda a execução cujo prazo de resposta venceu. */
async function scheduleAwaitTimeoutJob(
  client: AdminClient,
  input: {
    workspaceId: string
    executionId: string
    nodeId: string
    runAt: string
  },
) {
  const { data, error } = await client
    .from('scheduled_jobs')
    .upsert(
      {
        workspace_id: input.workspaceId,
        kind: 'automation_await_timeout',
        dedupe_key: `flow:${input.executionId}:await:${input.nodeId}`,
        payload: {
          flowExecutionId: input.executionId,
          nodeId: input.nodeId,
        },
        run_at: input.runAt,
        // O reenvio de uma pergunta reestaciona no mesmo nó. Se o prazo
        // anterior já tivesse disparado, sem reabrir o novo nunca dispararia e
        // a execução ficaria esperando para sempre.
        status: 'pending',
      },
      { onConflict: 'workspace_id,dedupe_key' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data
}

/** Retoma o fluxo somente depois que a entrega assinada ao n8n foi confirmada. */
export async function resumeAutomationAfterIntegration(
  input: {
    workspaceId: string
    executionId: string
    nodeId: string
    nextNodeId: string
  },
  client = getSupabaseAdmin(),
) {
  if (!client) throw new Error('automation_supabase_unavailable')
  const { error: stepError } = await client
    .from('automation_execution_steps')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('workspace_id', input.workspaceId)
    .eq('execution_id', input.executionId)
    .eq('node_id', input.nodeId)
    .eq('attempt', 1)
  if (stepError) throw stepError
  const nextJob = await scheduleAutomationJob(client, {
    workspaceId: input.workspaceId,
    executionId: input.executionId,
    nodeId: input.nextNodeId,
    runAt: new Date().toISOString(),
    dedupeKey: `flow:${input.executionId}:after-integration:${input.nodeId}`,
  })
  await updateExecution(client, input.executionId, input.workspaceId, {
    status: 'scheduled',
    current_node_id: input.nextNodeId,
    last_error_code: null,
  })
  return { status: 'scheduled', jobId: nextJob.id }
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
        status: 'pending',
      },
      { onConflict: 'workspace_id,dedupe_key' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data
}

async function scheduleFlowMessage(
  client: AdminClient,
  execution: {
    id: string
    workspace_id: string
    contact_id: string
    platform: string
    context: unknown
  },
  input: {
    nodeId: string
    nextNodeId: string
    message: string
    bookingPageId: string | null
    mediaUrl: string | null
    mediaType: 'image' | 'video' | null
    aiGenerated: boolean
    choices?: Array<AutomationChoice> | null
    /** Presente quando o nó deve parar e esperar o contato responder. */
    awaits?: {
      kind: 'choice' | 'input'
      timeoutSeconds: number | null
      /** Tentativas já gastas neste nó; o estacionamento precisa preservá-las. */
      attempts?: number
    } | null
    /**
     * Diferencia jobs do mesmo nó. Sem isto, o reenvio de uma pergunta cairia
     * na chave do prompt original e o upsert atingiria a linha já concluída.
     */
    dedupeSuffix?: string
  },
) {
  const context = execution.context as Record<string, unknown>
  const { data, error } = await client
    .from('scheduled_jobs')
    .upsert(
      {
        workspace_id: execution.workspace_id,
        kind: 'sequence_step',
        dedupe_key: `flow:${execution.id}:message:${input.nodeId}${
          input.dedupeSuffix ?? ''
        }`,
        payload: {
          platform: execution.platform,
          contactId: execution.contact_id,
          responseText: input.message,
          bookingPageId: input.bookingPageId,
          mediaUrl: input.mediaUrl,
          mediaType: input.mediaType,
          aiGenerated: input.aiGenerated,
          senderId: context.senderId ?? null,
          instagramCommentId: context.instagramCommentId ?? null,
          commentCreatedAt: context.commentCreatedAt ?? null,
          automationRunId: context.automationRunId ?? null,
          flowExecutionId: execution.id,
          flowNodeId: input.nodeId,
          flowNextNodeId: input.nextNodeId,
          flowChoices: input.choices ?? null,
          flowChoiceNodeId: input.choices?.length ? input.nodeId : null,
          flowAwait: input.awaits ?? null,
        },
        run_at: new Date().toISOString(),
        // `claim_due_scheduled_jobs` só enxerga 'pending'. Sem reabrir, um
        // upsert sobre uma linha concluída nunca voltaria a ser executado.
        status: 'pending',
      },
      { onConflict: 'workspace_id,dedupe_key' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data
}

async function assertAutonomousAiEnabled(
  client: AdminClient,
  workspaceId: string,
) {
  if (getServerEnv().DEMO_MODE === 'true') return
  const { data, error } = await client
    .from('workspace_runtime_settings')
    .select('autonomous_ai_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw error
  if (!data?.autonomous_ai_enabled) throw new Error('autonomous_ai_disabled')
}

async function loadAutomationHistory(
  client: AdminClient,
  workspaceId: string,
  contactId: string,
) {
  const { data, error } = await client
    .from('messages')
    .select('direction,body')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(9)
  if (error) throw error
  return data.reverse().map((message) => ({
    role:
      message.direction === 'inbound'
        ? ('user' as const)
        : ('assistant' as const),
    content: String(message.body ?? '').slice(0, 4_000),
  }))
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

/** Resultado da tentativa de casar uma mensagem recebida com uma espera ativa. */
export type AutomationReplyOutcome =
  | { handled: false; reason: 'no_waiting_execution' | 'no_match' }
  | {
      handled: true
      executionId: string
      nodeId: string
      branch: string
      savedValue?: string | number
    }
  | { handled: true; executionId: string; nodeId: string; retried: true }

/**
 * Retoma a execução parada quando o contato responde.
 *
 * Devolve `handled: false` de propósito quando nada casa: a mensagem continua
 * seguindo o caminho normal — Inbox, gatilhos e IA — em vez de ser engolida por
 * um fluxo que estava esperando outra coisa.
 */
export async function resumeAutomationAfterReply(
  input: {
    workspaceId: string
    contactId: string
    text?: string | null
    payload?: string | null
  },
  client = getSupabaseAdmin(),
): Promise<AutomationReplyOutcome> {
  if (!client) throw new Error('automation_supabase_unavailable')

  // Um contato pode estar em mais de um fluxo. A resposta vale para a espera
  // mais recente, que é a conversa que ele está vendo na tela.
  const { data: execution, error } = await client
    .from('automation_executions')
    .select(
      'id,workspace_id,flow_version_id,awaiting_kind,awaiting_node_id,awaiting_attempts,contact_id,platform,context',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .eq('status', 'waiting_reply')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!execution?.awaiting_node_id)
    return { handled: false, reason: 'no_waiting_execution' }

  const graph = await loadExecutionGraph(client, execution)
  const node = automationNode(graph, execution.awaiting_node_id)

  if (node.type === 'message' && node.config.choices?.length) {
    const key = matchChoice(node.config.choices, {
      text: input.text,
      payload: input.payload,
    })
    // Texto livre não avança um menu: o contato continua podendo escrever e ser
    // atendido pelos outros caminhos enquanto a espera segue de pé.
    if (!key) return { handled: false, reason: 'no_match' }
    await advanceFromAwait(client, execution, graph, node.id, key)
    return {
      handled: true,
      executionId: execution.id,
      nodeId: node.id,
      branch: key,
    }
  }

  if (node.type === 'user_input') {
    const result = validateUserInput(input.text, node.config.expects)
    if (result.valid) {
      await saveUserInputValue(
        client,
        execution,
        node.config.save,
        result.value,
      )
      await advanceFromAwait(client, execution, graph, node.id, 'default')
      return {
        handled: true,
        executionId: execution.id,
        nodeId: node.id,
        branch: 'default',
        savedValue: result.value,
      }
    }

    const attempts = Number(execution.awaiting_attempts ?? 0) + 1
    if (attempts >= node.config.maxAttempts) {
      // Sem a porta `invalid` desenhada, encerrar é melhor que deixar o contato
      // preso repetindo uma pergunta que ele não consegue responder.
      if (!hasBranch(graph, node.id, 'invalid')) {
        await clearAwait(client, execution, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        return {
          handled: true,
          executionId: execution.id,
          nodeId: node.id,
          branch: 'invalid',
        }
      }
      await advanceFromAwait(client, execution, graph, node.id, 'invalid')
      return {
        handled: true,
        executionId: execution.id,
        nodeId: node.id,
        branch: 'invalid',
      }
    }

    // Ainda há tentativa: reenvia a orientação e continua esperando.
    await scheduleFlowMessage(client, execution, {
      nodeId: node.id,
      nextNodeId: node.id,
      message:
        node.config.invalidMessage ??
        USER_INPUT_REJECTION_MESSAGE[result.reason],
      bookingPageId: null,
      mediaUrl: null,
      mediaType: null,
      aiGenerated: false,
      awaits: {
        kind: 'input',
        timeoutSeconds: node.config.timeoutSeconds,
        attempts,
      },
      dedupeSuffix: `:retry:${attempts}`,
    })
    await updateExecution(client, execution.id, input.workspaceId, {
      awaiting_attempts: attempts,
    })
    return {
      handled: true,
      executionId: execution.id,
      nodeId: node.id,
      retried: true,
    }
  }

  return { handled: false, reason: 'no_waiting_execution' }
}

async function loadExecutionGraph(
  client: AdminClient,
  execution: { workspace_id: string; flow_version_id: string },
) {
  const { data, error } = await client
    .from('automation_flow_versions')
    .select('graph')
    .eq('workspace_id', execution.workspace_id)
    .eq('id', execution.flow_version_id)
    .single()
  if (error) throw error
  return validateAutomationGraph(data.graph)
}

function hasBranch(graph: AutomationGraph, from: string, branch: string) {
  return graph.edges.some(
    (edge) => edge.from === from && edge.branch === branch,
  )
}

async function clearAwait(
  client: AdminClient,
  execution: { id: string; workspace_id: string },
  changes: Record<string, unknown>,
) {
  await updateExecution(client, execution.id, execution.workspace_id, {
    ...changes,
    awaiting_kind: null,
    awaiting_node_id: null,
    awaiting_until: null,
    awaiting_attempts: 0,
  })
}

/** Limpa a espera e agenda o próximo nó da porta escolhida. */
async function advanceFromAwait(
  client: AdminClient,
  execution: { id: string; workspace_id: string },
  graph: AutomationGraph,
  nodeId: string,
  branch: string,
) {
  const nextNodeId = automationNextNode(graph, nodeId, branch)
  await scheduleAutomationJob(client, {
    workspaceId: execution.workspace_id,
    executionId: execution.id,
    nodeId: nextNodeId,
    runAt: new Date().toISOString(),
    // O nó e a porta entram na chave: repetir a mesma escolha não reagenda o
    // passo, mas trocar de porta continua funcionando.
    dedupeKey: 'flow:' + execution.id + ':reply:' + nodeId + ':' + branch,
  })
  await clearAwait(client, execution, {
    status: 'scheduled',
    current_node_id: nextNodeId,
    last_error_code: null,
  })
}

/**
 * Colunas de contato que uma pergunta pode preencher.
 *
 * A chave vem da configuração do fluxo. Mesmo sendo escrita por um admin, ela
 * não pode virar nome de coluna livre: sem esta lista, um fluxo conseguiria
 * escrever em `workspace_id`, `lead_score` ou qualquer outra coluna do CRM.
 */
const WRITABLE_CONTACT_COLUMNS = new Set([
  'email',
  'phone',
  'full_name',
  'display_name',
  'company',
  'job_title',
  'city',
  'state',
  'country_code',
  'language',
  'timezone',
])

/** Grava a resposta validada no destino escolhido no nó. */
async function saveUserInputValue(
  client: AdminClient,
  execution: { id: string; workspace_id: string; contact_id: string },
  save: { target: 'contact' | 'custom' | 'bot'; fieldKey: string },
  value: string | number,
) {
  if (save.target === 'bot') {
    // Campos de bot são declarados antes pelo operador, com rótulo e tipo.
    // Criar um aqui produziria uma linha sem `label` nem `field_type`, que o
    // banco recusa, então a pergunta só atualiza o que já existe.
    const { data, error } = await client
      .from('automation_bot_fields')
      .update({ value })
      .eq('workspace_id', execution.workspace_id)
      .eq('field_key', save.fieldKey)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('automation_bot_field_missing')
    return
  }

  if (save.target === 'contact') {
    if (!WRITABLE_CONTACT_COLUMNS.has(save.fieldKey))
      throw new Error('automation_contact_field_not_writable')
    const { error } = await client
      .from('contacts')
      .update({ [save.fieldKey]: String(value) })
      .eq('workspace_id', execution.workspace_id)
      .eq('id', execution.contact_id)
    if (error) throw error
    return
  }

  // `custom_fields` é um jsonb do próprio contato: precisa ser lido e mesclado
  // para não apagar as outras respostas já coletadas.
  const { data: contact, error: contactError } = await client
    .from('contacts')
    .select('custom_fields')
    .eq('workspace_id', execution.workspace_id)
    .eq('id', execution.contact_id)
    .single()
  if (contactError) throw contactError

  // A coluna é `not null default '{}'`, então não há caso nulo a cobrir aqui.
  const custom = {
    ...(contact.custom_fields as Record<string, unknown>),
    [save.fieldKey]: value,
  }
  const { error } = await client
    .from('contacts')
    .update({ custom_fields: custom })
    .eq('workspace_id', execution.workspace_id)
    .eq('id', execution.contact_id)
  if (error) throw error
}

/** Fecha a espera vencida pela porta `timeout`, ou encerra se ela não existir. */
export async function expireAutomationAwait(
  input: { workspaceId: string; executionId: string; nodeId: string },
  client = getSupabaseAdmin(),
) {
  if (!client) throw new Error('automation_supabase_unavailable')
  const { data: execution, error } = await client
    .from('automation_executions')
    .select('id,workspace_id,flow_version_id,status,awaiting_node_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.executionId)
    .maybeSingle()
  if (error) throw error
  // O contato pode ter respondido entre o agendamento e o disparo do job.
  if (
    !execution ||
    execution.status !== 'waiting_reply' ||
    execution.awaiting_node_id !== input.nodeId
  )
    return { expired: false }

  const graph = await loadExecutionGraph(client, execution)
  if (!hasBranch(graph, input.nodeId, 'timeout')) {
    await clearAwait(client, execution, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    return { expired: true, branch: null }
  }

  await advanceFromAwait(client, execution, graph, input.nodeId, 'timeout')
  return { expired: true, branch: 'timeout' }
}

/** Teto do corpo lido de uma API externa; acima disso a resposta é descartada. */
const EXTERNAL_RESPONSE_LIMIT = 256 * 1024

/**
 * Lê um caminho por pontos dentro do JSON de resposta.
 *
 * Só percorre propriedades próprias: mesmo com o contrato recusando `__proto__`,
 * uma leitura ingênua ainda alcançaria chaves herdadas de um corpo hostil.
 */
export function readJsonPath(source: unknown, path: string): unknown {
  let current = source
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment))
      return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Só valores escalares vão para um campo; objeto inteiro não cabe num campo. */
export function scalarFromResponse(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return String(value)
  return null
}

export type ExternalRequestOutcome = {
  ok: boolean
  status: number | null
  mapped: number
  errorCode?: string
}

/**
 * Executa a chamada externa configurada no nó.
 *
 * O destino é validado a cada execução, e não só na publicação: a URL pode
 * conter variáveis do contato, então o host final só existe agora.
 */
export async function runExternalRequest(
  input: {
    url: string
    method: string
    headers: Array<{ key: string; value: string }>
    body?: string
    timeoutMs: number
  },
  fetcher: typeof fetch = fetch,
): Promise<{ outcome: ExternalRequestOutcome; payload: unknown }> {
  let safeUrl: URL
  try {
    safeUrl = await assertSafeOutboundUrl(input.url, { allowQuery: true })
  } catch (error) {
    return {
      outcome: {
        ok: false,
        status: null,
        mapped: 0,
        errorCode:
          error instanceof OutboundUrlError ? 'unsafe_target' : 'invalid_url',
      },
      payload: null,
    }
  }

  const headers = new Headers()
  for (const header of input.headers) headers.set(header.key, header.value)
  const sendsBody = !['GET', 'HEAD'].includes(input.method)
  if (sendsBody && input.body && !headers.has('content-type'))
    headers.set('content-type', 'application/json')

  let response: Response
  try {
    response = await fetcher(safeUrl, {
      method: input.method,
      headers,
      body: sendsBody ? (input.body ?? undefined) : undefined,
      signal: AbortSignal.timeout(input.timeoutMs),
      // Um redirect escaparia da validação de destino que acabou de rodar.
      redirect: 'error',
    })
  } catch {
    return {
      outcome: { ok: false, status: null, mapped: 0, errorCode: 'unreachable' },
      payload: null,
    }
  }

  const text = await readBounded(response, EXTERNAL_RESPONSE_LIMIT)
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // Resposta que não é JSON ainda pode ter status de sucesso; só não há o que
    // mapear para campos.
    payload = null
  }

  return {
    outcome: {
      ok: response.ok,
      status: response.status,
      mapped: 0,
      ...(response.ok ? {} : { errorCode: `http_${response.status}` }),
    },
    payload,
  }
}

/** Lê o corpo em fluxo e para assim que o limite é ultrapassado. */
async function readBounded(response: Response, limitBytes: number) {
  const body = response.body
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let received = 0
  let result = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      // Com `done: false` o chunk sempre existe; o tipo do reader já garante.
      if (done) break
      received += value.byteLength
      if (received > limitBytes) {
        await reader.cancel()
        return ''
      }
      result += decoder.decode(value, { stream: true })
    }
    return result + decoder.decode()
  } catch {
    return ''
  } finally {
    reader.releaseLock()
  }
}
