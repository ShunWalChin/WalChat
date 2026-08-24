#!/usr/bin/env tsx

/**
 * Bootstrap transacional da ponte Wal Chat → n8n.
 *
 * A API key entra apenas por variável de ambiente. O script cria uma
 * Credential Header Auth com token derivado, um Webhook ativo no n8n, grava a
 * API key/URL/segredo cifrados no workspace e executa um evento de teste.
 * Nenhum segredo é impresso.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import {
  configureN8nConnection,
  deriveN8nWebhookAuthToken,
  disconnectN8nConnection,
  getN8nConnection,
  sendN8nEvent,
} from '../../src/server/n8n-integration.server'
import { getSupabaseAdmin } from '../../src/server/supabase-admin.server'

const baseUrl = required('N8N_BOOTSTRAP_BASE_URL').replace(/\/+$/, '')
const apiKey = required('N8N_BOOTSTRAP_API_KEY')
const workflowName =
  process.env.N8N_BOOTSTRAP_WORKFLOW_NAME ?? 'Wal Chat — Event Gateway v1'
const webhookPath =
  process.env.N8N_BOOTSTRAP_WEBHOOK_PATH ?? 'wal-chat-events-v1'
const credentialName = 'Wal Chat — Webhook Header Auth v1'
const subscriptions = [
  'contact.created',
  'contact.updated',
  'message.received',
  'booking.created',
  'automation.completed',
  'automation.node',
] as const

const maybeAdmin = getSupabaseAdmin()
if (!maybeAdmin) throw new Error('Supabase administrativo não configurado.')
const admin = maybeAdmin

const { workspaceId, actorUserId } = await resolveTenant()
if (await getN8nConnection(workspaceId))
  throw new Error(
    'Já existe uma conexão n8n neste workspace; use o wizard para atualizá-la.',
  )

const workflowList = await n8nRequest<{
  data?: Array<{ id: string; name: string }>
}>('/workflows?limit=100')
if (workflowList.data?.some((workflow) => workflow.name === workflowName))
  throw new Error(`O workflow "${workflowName}" já existe no n8n.`)

const signingSecret = randomBytes(32).toString('base64url')
const outboundWebhookUrl = `${baseUrl}/webhook/${webhookPath}`
let connectionCreated = false
let credentialId: string | null = null
let workflowId: string | null = null

try {
  const connection = await configureN8nConnection({
    workspaceId,
    actorUserId,
    configuration: {
      name: 'n8n FAT.Tech',
      baseUrl,
      apiKey,
      signingSecret,
      eventSubscriptions: [...subscriptions],
    },
  })
  connectionCreated = true

  const credential = await n8nRequest<{ id?: string }>('/credentials', {
    method: 'POST',
    body: JSON.stringify({
      name: credentialName,
      type: 'httpHeaderAuth',
      data: {
        name: 'X-WalChat-Webhook-Token',
        value: deriveN8nWebhookAuthToken(signingSecret),
      },
    }),
  })
  if (!credential.id) throw new Error('n8n não retornou o ID da Credential.')
  credentialId = credential.id

  const workflow = await n8nRequest<{ id?: string }>('/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: workflowName,
      nodes: [
        {
          parameters: {
            authentication: 'headerAuth',
            httpMethod: 'POST',
            path: webhookPath,
            options: {},
          },
          id: randomUUID(),
          name: 'Receber eventos do Wal Chat',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [0, 0],
          webhookId: randomUUID(),
          credentials: {
            httpHeaderAuth: { id: credentialId, name: credentialName },
          },
        },
      ],
      connections: {},
      settings: { executionOrder: 'v1' },
    }),
  })
  if (!workflow.id) throw new Error('n8n não retornou o ID do workflow.')
  workflowId = workflow.id

  const activated = await n8nRequest<{ active?: boolean }>(
    `/workflows/${workflowId}/activate`,
    { method: 'POST' },
  )
  if (!activated.active) throw new Error('O workflow não foi ativado pelo n8n.')

  await configureN8nConnection({
    workspaceId,
    actorUserId,
    configuration: {
      name: 'n8n FAT.Tech',
      outboundWebhookUrl,
      eventSubscriptions: [...subscriptions],
    },
  })

  const delivery = await sendN8nEvent({
    workspaceId,
    eventType: 'integration.test',
    payload: { source: 'wal-chat-bootstrap', contractVersion: 1 },
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        connectionId: connection.connectionId,
        workflowId,
        workflowActive: true,
        outboundWebhookUrl,
        inboundWebhookUrl: `${required('APP_ORIGIN')}/api/public/webhooks/n8n/${connection.connectionId}`,
        testDelivery: {
          status: 'status' in delivery ? delivery.status : null,
          attempts: 'attempts' in delivery ? delivery.attempts : null,
          skipped: delivery.skipped,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  await bestEffortRollback()
  throw error
}

async function resolveTenant() {
  const explicitWorkspaceId = process.env.N8N_BOOTSTRAP_WORKSPACE_ID
  const query = admin.from('workspaces').select('id,owner_id').limit(2)
  const { data, error } = explicitWorkspaceId
    ? await query.eq('id', explicitWorkspaceId)
    : await query
  if (error) throw error
  if (data.length !== 1)
    throw new Error(
      'Informe N8N_BOOTSTRAP_WORKSPACE_ID quando houver zero ou vários workspaces.',
    )
  return { workspaceId: data[0].id, actorUserId: data[0].owner_id }
}

async function n8nRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey,
      ...init.headers,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(
      `A API do n8n recusou a operação (HTTP ${response.status}).`,
    )
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}

async function bestEffortRollback() {
  if (workflowId)
    await n8nRequest(`/workflows/${workflowId}`, { method: 'DELETE' }).catch(
      () => undefined,
    )
  if (credentialId)
    await n8nRequest(`/credentials/${credentialId}`, {
      method: 'DELETE',
    }).catch(() => undefined)
  if (connectionCreated)
    await disconnectN8nConnection({ workspaceId, actorUserId }).catch(
      () => undefined,
    )
}

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`)
  return value
}
