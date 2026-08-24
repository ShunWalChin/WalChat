#!/usr/bin/env tsx

/**
 * Smoke opt-in dos comandos n8n → Wal Chat, sem disparo Meta.
 *
 * Cria um contato sintético, aplica uma tag única, verifica os vínculos e
 * remove somente os registros criados pelo próprio ensaio. A execução exige
 * N8N_RUN_WRITE_SMOKE=true para impedir writes acidentais.
 */
import { randomUUID } from 'node:crypto'
import {
  deriveN8nWebhookAuthToken,
  getN8nConnectionById,
} from '../../src/server/n8n-integration.server'
import { getIntegrationCredential } from '../../src/server/integration-credentials.server'
import { getSupabaseAdmin } from '../../src/server/supabase-admin.server'
import { N8N_WEBHOOK_PATHS } from './n8n-workflow-definitions'

if (process.env.N8N_RUN_WRITE_SMOKE !== 'true')
  throw new Error('Confirme o ensaio com N8N_RUN_WRITE_SMOKE=true.')

const admin = requireAdminClient()
const connectionId = required('N8N_CONNECTION_ID')
const connectionRecord = await getN8nConnectionById(connectionId, admin)
if (!connectionRecord || connectionRecord.status !== 'connected')
  throw new Error('Conexão n8n não encontrada ou inativa.')
const connection = connectionRecord
const signingSecret = await getIntegrationCredential({
  workspaceId: connection.workspace_id,
  provider: 'n8n',
  credentialType: 'api_key',
  scopeKey: `signing:${connection.id}`,
})
if (!signingSecret?.value)
  throw new Error('Segredo cifrado da conexão n8n não encontrado.')

const baseUrl = connection.base_url.replace(/\/+$/, '')
const token = deriveN8nWebhookAuthToken(signingSecret.value)
const smokeId = randomUUID()
const externalId = `wal-chat-smoke:${smokeId}`
const email = `wal-chat-smoke-${smokeId}@example.com`
const tagName = `Wal Chat Smoke ${smokeId.slice(0, 8)}`
let contactId: string | null = null
let tagId: string | null = null

try {
  const contactResult = await command(N8N_WEBHOOK_PATHS.contactUpsert, {
    deliveryId: `smoke.contact.${smokeId}`,
    data: {
      externalId,
      fullName: 'Wal Chat — Contato sintético de smoke',
      email,
      lifecycleStage: 'lead',
      marketingConsent: 'unknown',
      customFields: { source: 'n8n-production-smoke', synthetic: true },
    },
  })
  contactId = readResultId(contactResult, 'contactId')

  const tagResult = await command(N8N_WEBHOOK_PATHS.tagApply, {
    deliveryId: `smoke.tag.${smokeId}`,
    data: { externalId, tagName, tagColor: '#1D7A55' },
  })
  tagId = readResultId(tagResult, 'tagId')

  const [
    { data: contact, error: contactError },
    { data: link, error: linkError },
  ] = await Promise.all([
    admin
      .from('contacts')
      .select('id,workspace_id,import_source')
      .eq('id', contactId)
      .eq('workspace_id', connection.workspace_id)
      .maybeSingle(),
    admin
      .from('integration_contact_links')
      .select('contact_id,external_id')
      .eq('connection_id', connection.id)
      .eq('external_id', externalId)
      .maybeSingle(),
  ])
  if (contactError) throw contactError
  if (linkError) throw linkError
  if (!contact || contact.import_source !== 'n8n')
    throw new Error('Contato sintético não foi persistido corretamente.')
  if (!link || link.contact_id !== contactId)
    throw new Error('Vínculo externo do contato não foi persistido.')

  const { data: assignment, error: assignmentError } = await admin
    .from('contact_tags')
    .select('contact_id,tag_id')
    .eq('workspace_id', connection.workspace_id)
    .eq('contact_id', contactId)
    .eq('tag_id', tagId)
    .maybeSingle()
  if (assignmentError) throw assignmentError
  if (!assignment) throw new Error('Tag sintética não foi aplicada ao contato.')
} finally {
  await cleanup()
}
await verifyCleanup()
console.log(
  JSON.stringify(
    {
      ok: true,
      contactUpsert: 'completed',
      tagApply: 'completed',
      databaseVerification: 'completed',
      syntheticCleanup: 'completed',
      realContactDataUsed: false,
      realMetaMessagesSent: 0,
    },
    null,
    2,
  ),
)

async function command(
  path: string,
  input: { deliveryId: string; data: Record<string, unknown> },
) {
  const response = await fetch(`${baseUrl}/webhook/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-WalChat-Webhook-Token': token,
      'X-WalChat-Delivery-Id': input.deliveryId,
    },
    body: JSON.stringify({ deliveryId: input.deliveryId, data: input.data }),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (!response.ok)
    throw new Error(`${path} respondeu HTTP ${response.status}.`)
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>
}

function readResultId(payload: Record<string, unknown>, key: string) {
  const result = payload.result
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error(`Resposta n8n sem result.${key}.`)
  const value = (result as Record<string, unknown>)[key]
  if (typeof value !== 'string' || !value)
    throw new Error(`Resposta n8n sem result.${key}.`)
  return value
}

async function cleanup() {
  const failures: string[] = []
  if (contactId) {
    // A ordem evita depender de cascades e mantém o alvo sempre exato.
    const results = []
    results.push(
      await admin
        .from('contact_tags')
        .delete()
        .eq('workspace_id', connection.workspace_id)
        .eq('contact_id', contactId),
    )
    results.push(
      await admin
        .from('integration_contact_links')
        .delete()
        .eq('connection_id', connection.id)
        .eq('external_id', externalId)
        .eq('contact_id', contactId),
    )
    results.push(
      await admin
        .from('contacts')
        .delete()
        .eq('workspace_id', connection.workspace_id)
        .eq('id', contactId)
        .eq('email', email),
    )
    results.forEach((result, index) => {
      if (result.error) failures.push(`contact_cleanup_${index}`)
    })
  }
  if (tagId) {
    const { error } = await admin
      .from('tags')
      .delete()
      .eq('workspace_id', connection.workspace_id)
      .eq('id', tagId)
      .eq('name', tagName)
    if (error) failures.push('tag_cleanup')
  }
  if (failures.length)
    throw new Error(`Falha ao limpar smoke sintético: ${failures.join(',')}`)
}

async function verifyCleanup() {
  const [links, contacts, tags] = await Promise.all([
    admin
      .from('integration_contact_links')
      .select('external_id', { count: 'exact', head: true })
      .eq('connection_id', connection.id)
      .eq('external_id', externalId),
    admin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', connection.workspace_id)
      .eq('email', email),
    admin
      .from('tags')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', connection.workspace_id)
      .eq('name', tagName),
  ])
  const error = links.error ?? contacts.error ?? tags.error
  if (error) throw error
  if ((links.count ?? 0) + (contacts.count ?? 0) + (tags.count ?? 0) !== 0)
    throw new Error('O smoke deixou resíduos sintéticos no banco.')
}

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`)
  return value
}

function requireAdminClient() {
  const value = getSupabaseAdmin()
  if (!value) throw new Error('Supabase administrativo não configurado.')
  return value
}
