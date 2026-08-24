#!/usr/bin/env tsx

/**
 * Provisiona, valida, ativa e testa a suíte operacional Wal Chat no n8n.
 *
 * O processo é idempotente e transacional por compensação: workflows novos
 * são removidos e workflows existentes são restaurados se qualquer etapa
 * falhar. Nenhum segredo é impresso ou gravado no JSON dos workflows.
 */
import {
  deriveN8nWebhookAuthToken,
  getN8nConnectionById,
  sendN8nEvent,
} from '../../src/server/n8n-integration.server'
import {
  getIntegrationCredential,
  writeIntegrationAudit,
} from '../../src/server/integration-credentials.server'
import { getSupabaseAdmin } from '../../src/server/supabase-admin.server'
import {
  buildWalChatN8nWorkflows,
  LEGACY_GATEWAY_WORKFLOW_NAME,
  N8N_WEBHOOK_PATHS,
  N8N_WORKFLOW_NAMES,
} from './n8n-workflow-definitions'
import type {
  N8nCredentialReference,
  N8nWorkflowDefinition,
} from './n8n-workflow-definitions'

type LiveWorkflow = N8nWorkflowDefinition & {
  id: string
  active: boolean
  createdAt?: string
  updatedAt?: string
  versionId?: string
}

type Snapshot = {
  id: string
  active: boolean
  definition: N8nWorkflowDefinition
}

const verifiedNodeVersions = new Set([
  'n8n-nodes-base.webhook@2',
  'n8n-nodes-base.code@2',
  'n8n-nodes-base.noOp@1',
  'n8n-nodes-base.httpRequest@4.2',
  'n8n-nodes-base.scheduleTrigger@1.2',
])

const connection = await resolveConnection()
const [storedApiKey, storedSigningSecret] = await Promise.all([
  getIntegrationCredential({
    workspaceId: connection.workspace_id,
    provider: 'n8n',
    credentialType: 'api_key',
    scopeKey: `api:${connection.id}`,
  }),
  getIntegrationCredential({
    workspaceId: connection.workspace_id,
    provider: 'n8n',
    credentialType: 'api_key',
    scopeKey: `signing:${connection.id}`,
  }),
])
if (!storedApiKey?.value || !storedSigningSecret?.value)
  throw new Error('Credenciais cifradas da conexão n8n estão incompletas.')

const apiKey = storedApiKey.value
const signingSecret = storedSigningSecret.value
const baseUrl = connection.base_url.replace(/\/+$/, '')
const appOrigin = required('APP_ORIGIN').replace(/\/+$/, '')
const walChatInboundUrl = `${appOrigin}/api/public/webhooks/n8n/${connection.id}`
const walChatReadinessUrl = `${appOrigin}/api/ready`

const initialList = await listWorkflows()
const gatewayCandidates = initialList.filter((workflow) =>
  [N8N_WORKFLOW_NAMES.gateway, LEGACY_GATEWAY_WORKFLOW_NAME].includes(
    workflow.name as
      typeof N8N_WORKFLOW_NAMES.gateway | typeof LEGACY_GATEWAY_WORKFLOW_NAME,
  ),
)
if (gatewayCandidates.length !== 1)
  throw new Error(
    `Esperado um gateway Wal Chat existente; encontrados ${gatewayCandidates.length}.`,
  )
const currentGateway = await getWorkflow(gatewayCandidates[0].id)
const gatewayWebhook = currentGateway.nodes.find(
  (node) =>
    node.type === 'n8n-nodes-base.webhook' &&
    node.parameters.path === N8N_WEBHOOK_PATHS.gateway,
)
if (!gatewayWebhook)
  throw new Error('O gateway existente não possui o Webhook esperado.')
const credential: N8nCredentialReference | undefined =
  gatewayWebhook.credentials?.httpHeaderAuth
if (!credential?.id || !credential.name)
  throw new Error('A Credential Header Auth do gateway não foi encontrada.')

const definitions = buildWalChatN8nWorkflows({
  credential,
  walChatInboundUrl,
  walChatReadinessUrl,
  gatewayWebhookId: gatewayWebhook.webhookId,
})
validateDefinitions(definitions, [apiKey, signingSecret])

// O gateway é atualizado por último para reduzir a interrupção a poucos ms.
const orderedDefinitions = [
  ...definitions.filter(
    (workflow) => workflow.name !== N8N_WORKFLOW_NAMES.gateway,
  ),
  definitions.find((workflow) => workflow.name === N8N_WORKFLOW_NAMES.gateway)!,
]
const snapshots = new Map<string, Snapshot>()
const createdIds: string[] = []
const managed = new Map<string, string>()

try {
  for (const definition of orderedDefinitions) {
    const existing = findExistingWorkflow(
      initialList,
      definition.name,
      currentGateway,
    )
    if (existing) {
      const live =
        existing.id === currentGateway.id
          ? currentGateway
          : await getWorkflow(existing.id)
      snapshots.set(live.id, {
        id: live.id,
        active: live.active,
        definition: updateBody(live),
      })
      if (live.active) await deactivateWorkflow(live.id)
      const updated = await n8nRequest<LiveWorkflow>(`/workflows/${live.id}`, {
        method: 'PUT',
        body: JSON.stringify(definition),
      })
      managed.set(definition.name, updated.id)
    } else {
      const created = await n8nRequest<LiveWorkflow>('/workflows', {
        method: 'POST',
        body: JSON.stringify(definition),
      })
      if (!created.id)
        throw new Error(`n8n não retornou ID para ${definition.name}.`)
      createdIds.push(created.id)
      managed.set(definition.name, created.id)
    }
  }

  await validateProvisionedWorkflows(definitions, managed)

  // Comandos são públicos somente via Header Auth; todos os efeitos ainda
  // passam pelo contrato, idempotência e compliance do backend Wal Chat.
  for (const definition of orderedDefinitions) {
    const id = managed.get(definition.name)
    if (!id) throw new Error(`Workflow não provisionado: ${definition.name}`)
    const activated = await activateWorkflow(id)
    if (!activated.active)
      throw new Error(`O n8n não ativou ${definition.name}.`)
  }

  const tests = await runSafeProductionTests()
  await writeIntegrationAudit({
    workspaceId: connection.workspace_id,
    provider: 'n8n',
    action: 'workflow_suite.provisioned',
    status: 'success',
    resourceId: connection.id,
    details: {
      workflowIds: Object.fromEntries(managed),
      tests,
      externalEffects: false,
    },
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        connectionId: connection.id,
        host: new URL(baseUrl).host,
        workflows: definitions.map((definition) => ({
          id: managed.get(definition.name),
          name: definition.name,
          active: true,
          webhookUrl: webhookUrlFor(definition.name),
        })),
        tests,
        safety: {
          realMetaMessagesSent: 0,
          validWriteCommandsExecuted: 0,
          credentialValuesExposed: false,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  await rollback()
  await writeIntegrationAudit({
    workspaceId: connection.workspace_id,
    provider: 'n8n',
    action: 'workflow_suite.provisioned',
    status: 'failure',
    resourceId: connection.id,
    details: {
      error:
        error instanceof Error ? error.message.slice(0, 300) : 'unknown_error',
    },
  }).catch(() => undefined)
  throw error
}

async function runSafeProductionTests() {
  const token = deriveN8nWebhookAuthToken(signingSecret)
  const integrationDelivery = await sendN8nEvent({
    workspaceId: connection.workspace_id,
    eventType: 'integration.test',
    payload: {
      source: 'n8n-operational-workflow-provisioner',
      contractVersion: 1,
    },
  })
  if (integrationDelivery.skipped || !('status' in integrationDelivery))
    throw new Error('O teste do Event Gateway foi ignorado.')

  const healthResponse = await safeWebhookRequest(N8N_WEBHOOK_PATHS.health, {
    token,
    body: {},
  })
  if (healthResponse.status !== 200)
    throw new Error(
      `O diagnóstico autenticado respondeu HTTP ${healthResponse.status}.`,
    )

  const negativeAuth: Record<string, number> = {}
  const invalidContract: Record<string, number> = {}
  for (const path of [
    N8N_WEBHOOK_PATHS.contactUpsert,
    N8N_WEBHOOK_PATHS.tagApply,
    N8N_WEBHOOK_PATHS.automationExecute,
  ]) {
    const unauthorized = await safeWebhookRequest(path, { body: {} })
    if (unauthorized.status !== 403)
      throw new Error(`${path} não bloqueou a chamada sem credencial.`)
    negativeAuth[path] = unauthorized.status

    // Payload inválido confirma autenticação e validação sem executar writes.
    const invalid = await safeWebhookRequest(path, { token, body: {} })
    if (invalid.status < 400)
      throw new Error(`${path} aceitou um contrato inválido.`)
    invalidContract[path] = invalid.status
  }

  return {
    gateway: {
      status: integrationDelivery.status,
      attempts: integrationDelivery.attempts,
    },
    health: healthResponse.status,
    negativeAuth,
    invalidContract,
  }
}

async function safeWebhookRequest(
  path: string,
  input: { token?: string; body: Record<string, unknown> },
) {
  const response = await fetch(`${baseUrl}/webhook/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.token ? { 'X-WalChat-Webhook-Token': input.token } : {}),
    },
    body: JSON.stringify(input.body),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  await response.arrayBuffer()
  return { status: response.status }
}

async function validateProvisionedWorkflows(
  expected: N8nWorkflowDefinition[],
  ids: Map<string, string>,
) {
  for (const definition of expected) {
    const id = ids.get(definition.name)
    if (!id) throw new Error(`ID ausente para ${definition.name}.`)
    const live = await getWorkflow(id)
    if (live.active)
      throw new Error(`${definition.name} deveria estar inativo na validação.`)
    if (live.name !== definition.name)
      throw new Error(`Nome divergente no workflow ${id}.`)
    if (live.nodes.length !== definition.nodes.length)
      throw new Error(`Quantidade de nós divergente em ${definition.name}.`)
    const liveNodeKeys = new Set(
      live.nodes.map((node) => `${node.type}@${node.typeVersion}:${node.name}`),
    )
    for (const node of definition.nodes) {
      if (!liveNodeKeys.has(`${node.type}@${node.typeVersion}:${node.name}`))
        throw new Error(`Nó divergente em ${definition.name}: ${node.name}.`)
    }
  }
}

function validateDefinitions(
  workflowDefinitions: N8nWorkflowDefinition[],
  forbiddenValues: string[],
) {
  if (workflowDefinitions.length !== Object.keys(N8N_WORKFLOW_NAMES).length)
    throw new Error('A suíte n8n está incompleta.')
  const names = new Set<string>()
  const paths = new Set<string>()
  for (const workflow of workflowDefinitions) {
    if (names.has(workflow.name))
      throw new Error(`Workflow duplicado: ${workflow.name}`)
    names.add(workflow.name)
    for (const node of workflow.nodes) {
      const versionKey = `${node.type}@${node.typeVersion}`
      if (!verifiedNodeVersions.has(versionKey))
        throw new Error(`Versão de nó não inventariada: ${versionKey}`)
      if (node.type === 'n8n-nodes-base.webhook') {
        const path = String(node.parameters.path ?? '')
        if (!path || paths.has(path))
          throw new Error(`Webhook path ausente ou duplicado: ${path}`)
        paths.add(path)
        if (node.parameters.authentication !== 'headerAuth')
          throw new Error(`Webhook sem Header Auth: ${workflow.name}`)
      }
    }
  }
  const serialized = JSON.stringify(workflowDefinitions)
  for (const value of forbiddenValues) {
    if (value && serialized.includes(value))
      throw new Error('Um segredo seria persistido no JSON do workflow.')
  }
}

function findExistingWorkflow(
  workflows: LiveWorkflow[],
  name: string,
  gateway: LiveWorkflow,
) {
  if (name === N8N_WORKFLOW_NAMES.gateway) return gateway
  const matches = workflows.filter((workflow) => workflow.name === name)
  if (matches.length > 1)
    throw new Error(`Existem workflows duplicados com nome ${name}.`)
  return matches.length === 1 ? matches[0] : null
}

async function rollback() {
  for (const id of [...createdIds].reverse()) {
    await deactivateWorkflow(id).catch(() => undefined)
    await n8nRequest(`/workflows/${id}`, { method: 'DELETE' }).catch(
      () => undefined,
    )
  }
  for (const snapshot of [...snapshots.values()].reverse()) {
    await deactivateWorkflow(snapshot.id).catch(() => undefined)
    await n8nRequest(`/workflows/${snapshot.id}`, {
      method: 'PUT',
      body: JSON.stringify(snapshot.definition),
    }).catch(() => undefined)
    if (snapshot.active)
      await activateWorkflow(snapshot.id).catch(() => undefined)
  }
}

function updateBody(workflow: LiveWorkflow): N8nWorkflowDefinition {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
  }
}

function webhookUrlFor(name: string) {
  const entry = Object.entries(N8N_WORKFLOW_NAMES).find(
    ([, workflowName]) => workflowName === name,
  )
  if (!entry) return null
  const path = N8N_WEBHOOK_PATHS[entry[0] as keyof typeof N8N_WEBHOOK_PATHS]
  return `${baseUrl}/webhook/${path}`
}

async function listWorkflows() {
  const payload = await n8nRequest<{ data?: LiveWorkflow[] }>(
    '/workflows?limit=100',
  )
  return payload.data ?? []
}

function getWorkflow(id: string) {
  return n8nRequest<LiveWorkflow>(`/workflows/${id}`)
}

function activateWorkflow(id: string) {
  return n8nRequest<LiveWorkflow>(`/workflows/${id}/activate`, {
    method: 'POST',
  })
}

function deactivateWorkflow(id: string) {
  return n8nRequest<LiveWorkflow>(`/workflows/${id}/deactivate`, {
    method: 'POST',
  })
}

async function n8nRequest<T = Record<string, never>>(
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey,
      ...init.headers,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok)
    throw new Error(
      `A API do n8n respondeu HTTP ${response.status} em ${path}.`,
    )
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}

async function resolveConnection() {
  const explicitId = process.env.N8N_CONNECTION_ID?.trim()
  if (explicitId) {
    const record = await getN8nConnectionById(explicitId)
    if (!record) throw new Error('Conexão n8n informada não foi encontrada.')
    return record
  }
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('Supabase administrativo não configurado.')
  const { data, error } = await admin
    .from('integration_connections')
    .select(
      'id,workspace_id,name,base_url,status,detected_version,event_subscriptions,last_validated_at,last_event_at,last_error,created_at',
    )
    .eq('provider', 'n8n')
    .limit(2)
  if (error) throw error
  if (data.length !== 1)
    throw new Error(
      'Informe N8N_CONNECTION_ID quando houver zero ou várias conexões n8n.',
    )
  return data[0]
}

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`)
  return value
}
