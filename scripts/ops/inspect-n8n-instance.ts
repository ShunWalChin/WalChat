#!/usr/bin/env tsx

/**
 * Inventário sanitizado da instância n8n conectada ao Wal Chat.
 *
 * A API key é recuperada do cofre cifrado do backend. O relatório não inclui
 * credenciais, parâmetros de nós, payloads de execução ou dados de contatos.
 */
import { getIntegrationCredential } from '../../src/server/integration-credentials.server'
import { getN8nConnectionById } from '../../src/server/n8n-integration.server'
import { getSupabaseAdmin } from '../../src/server/supabase-admin.server'

type WorkflowSummary = {
  id: string
  name: string
  active: boolean
  nodes?: Array<{
    name: string
    type: string
    typeVersion: number
    disabled?: boolean
  }>
}

const connection = await resolveConnection()
const storedApiKey = await getIntegrationCredential({
  workspaceId: connection.workspace_id,
  provider: 'n8n',
  credentialType: 'api_key',
  scopeKey: `api:${connection.id}`,
})
if (!storedApiKey?.value)
  throw new Error('A API key cifrada da conexão n8n não foi encontrada.')

const response = await fetch(
  `${connection.base_url.replace(/\/+$/, '')}/api/v1/workflows?limit=100`,
  {
    headers: {
      Accept: 'application/json',
      'X-N8N-API-KEY': storedApiKey.value,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  },
)
if (!response.ok)
  throw new Error(`A API do n8n respondeu HTTP ${response.status}.`)

const payload = (await response.json()) as { data?: WorkflowSummary[] }
const workflows = payload.data ?? []
const nodeCatalog = [
  ...new Map(
    workflows
      .flatMap((workflow) => workflow.nodes ?? [])
      .map((node) => [
        `${node.type}@${node.typeVersion}`,
        { type: node.type, typeVersion: node.typeVersion },
      ]),
  ).values(),
].sort((left, right) => left.type.localeCompare(right.type))
const includeWorkflows = process.env.N8N_INSPECT_SUMMARY_ONLY !== 'true'
console.log(
  JSON.stringify(
    {
      ok: true,
      connection: {
        id: connection.id,
        host: new URL(connection.base_url).host,
        status: connection.status,
        detectedVersion: connection.detected_version,
      },
      workflowCount: workflows.length,
      nodeCatalog,
      ...(includeWorkflows
        ? {
            workflows: workflows.map((workflow) => ({
              id: workflow.id,
              name: workflow.name,
              active: workflow.active,
              nodes: (workflow.nodes ?? []).map((node) => ({
                name: node.name,
                type: node.type,
                typeVersion: node.typeVersion,
                disabled: node.disabled === true,
              })),
            })),
          }
        : {}),
    },
    null,
    2,
  ),
)

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
