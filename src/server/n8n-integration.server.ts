/** Runtime seguro, observável e multi-tenant da integração n8n. */
import '@tanstack/react-start/server-only'
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isPublicAddress } from './outbound-url'
import { ApiError } from './api-auth.server'
import { startAutomationExecution } from './automation-engine.server'
import { getServerEnv } from './env.server'
import {
  deleteIntegrationCredential,
  getIntegrationCredential,
  saveIntegrationCredential,
  writeIntegrationAudit,
} from './integration-credentials.server'
import type {
  N8nConfigureInput,
  N8nInboundEvent,
  N8nOutboundEventType,
} from './n8n-contract'
import { n8nInboundEventSchema } from './n8n-contract'
import { getSupabaseAdmin } from './supabase-admin.server'

const WEBHOOK_CLOCK_SKEW_SECONDS = 300
const N8N_TIMEOUT_MS = 8_000
const N8N_WEBHOOK_AUTH_CONTEXT = 'wal-chat-n8n-webhook-auth-v1'
const credentialScopes = {
  apiKey: (id: string) => `api:${id}`,
  outboundUrl: (id: string) => `outbound:${id}`,
  signingSecret: (id: string) => `signing:${id}`,
}

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>
type N8nConnectionRow = {
  id: string
  workspace_id: string
  name: string
  base_url: string
  status: string
  detected_version: string | null
  event_subscriptions: string[]
  last_validated_at: string | null
  last_event_at: string | null
  last_error: string | null
  created_at: string
}

export function signN8nPayload(
  rawBody: string,
  timestamp: string,
  secret: string,
) {
  return `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex')}`
}

/**
 * Token estático de defesa em profundidade para a Credential Header Auth do
 * n8n. O n8n recebe apenas o derivado: ele não permite recuperar o segredo
 * HMAC usado para assinar o corpo e o timestamp de cada entrega.
 */
export function deriveN8nWebhookAuthToken(secret: string) {
  return createHmac('sha256', secret)
    .update(N8N_WEBHOOK_AUTH_CONTEXT, 'utf8')
    .digest('base64url')
}

export function verifyN8nPayload(input: {
  rawBody: string
  timestamp: string | null
  signature: string | null
  secret: string
  now?: number
}) {
  const timestamp = input.timestamp
  if (!timestamp || !isFreshN8nTimestamp(timestamp, input.now)) return false
  if (!input.signature?.startsWith('sha256=')) return false
  const expected = Buffer.from(
    signN8nPayload(input.rawBody, timestamp, input.secret),
    'utf8',
  )
  const received = Buffer.from(input.signature, 'utf8')
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}

/**
 * Alternativa para nós HTTP Request do n8n que não têm acesso ao segredo HMAC
 * da Credential. Continua exigindo TLS, timestamp recente, delivery ID único,
 * rate limit e comparação em tempo constante no endpoint receptor.
 */
export function verifyN8nWebhookAuthToken(input: {
  timestamp: string | null
  token: string | null
  secret: string
  now?: number
}) {
  if (!isFreshN8nTimestamp(input.timestamp, input.now) || !input.token)
    return false
  const expected = Buffer.from(deriveN8nWebhookAuthToken(input.secret), 'utf8')
  const received = Buffer.from(input.token, 'utf8')
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}

function isFreshN8nTimestamp(timestamp: string | null, now?: number) {
  if (!timestamp || !/^\d{10}$/.test(timestamp)) return false
  const age = Math.abs((now ?? Date.now()) - Number(timestamp) * 1_000)
  return age <= WEBHOOK_CLOCK_SKEW_SECONDS * 1_000
}

export function payloadSha256(rawBody: string) {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex')
}

/** Normaliza a URL sem vazar usuário/senha e bloqueia destinos internos por padrão. */
export async function assertSafeN8nUrl(
  value: string,
  resolveHost: typeof lookup = lookup,
) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiError(422, 'URL do n8n inválida.')
  }
  if (url.username || url.password || url.hash)
    throw new ApiError(422, 'A URL não pode conter credenciais ou fragmento.')
  if (!['http:', 'https:'].includes(url.protocol))
    throw new ApiError(422, 'A URL deve usar HTTP ou HTTPS.')

  const env = getServerEnv()
  const hostname = url.hostname.toLowerCase()
  const explicitlyAllowed = new Set(
    (env.N8N_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  ).has(hostname)
  const localDemo =
    env.DEMO_MODE === 'true' &&
    ['localhost', '127.0.0.1', '::1'].includes(hostname)
  if (url.protocol !== 'https:' && !localDemo && !explicitlyAllowed)
    throw new ApiError(422, 'Use HTTPS para conectar o n8n.')

  if (!explicitlyAllowed && !localDemo) {
    if (isIP(hostname)) {
      if (!isPublicAddress(hostname))
        throw new ApiError(
          422,
          'O destino n8n não pode usar IP privado ou reservado.',
        )
    } else {
      let addresses: Array<{ address: string; family: number }>
      try {
        addresses = await resolveHost(hostname, { all: true, verbatim: true })
      } catch {
        throw new ApiError(422, 'O host do n8n não pôde ser resolvido.')
      }
      if (
        !addresses.length ||
        addresses.some((item) => !isPublicAddress(item.address))
      )
        throw new ApiError(
          422,
          'O host do n8n resolve para uma rede não permitida.',
        )
    }
  }
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url
}

export function normalizeN8nBaseUrl(url: URL) {
  return url.toString().replace(/\/$/, '')
}

export function sanitizedN8nHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return 'host inválido'
  }
}

export async function testN8nApi(input: {
  baseUrl: string
  apiKey: string
  fetcher?: typeof fetch
}) {
  const safeUrl = await assertSafeN8nUrl(input.baseUrl)
  const endpoint = new URL(
    `${safeUrl.pathname.replace(/\/$/, '')}/api/v1/workflows`,
    safeUrl,
  )
  endpoint.searchParams.set('limit', '1')
  const response = await (input.fetcher ?? fetch)(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-N8N-API-KEY': input.apiKey,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
  }).catch((error: unknown) => {
    if (error instanceof ApiError) throw error
    throw new ApiError(502, 'Não foi possível alcançar a API do n8n.')
  })
  if (response.status === 401 || response.status === 403)
    throw new ApiError(422, 'A API key do n8n foi recusada.')
  if (!response.ok)
    throw new ApiError(502, `A API do n8n respondeu HTTP ${response.status}.`)
  const payload = (await response.json().catch(() => null)) as {
    data?: unknown[]
  } | null
  if (!payload || !Array.isArray(payload.data))
    throw new ApiError(502, 'A API do n8n retornou um contrato inesperado.')
  return {
    version: response.headers.get('x-n8n-version'),
    workflowProbeCount: payload.data.length,
  }
}

export async function configureN8nConnection(input: {
  workspaceId: string
  actorUserId: string
  configuration: N8nConfigureInput
}) {
  const admin = requireAdmin()
  const existing = await getN8nConnection(input.workspaceId, admin)
  const env = getServerEnv()
  const baseUrlValue =
    input.configuration.baseUrl ?? existing?.base_url ?? env.N8N_BASE_URL
  if (!baseUrlValue) throw new ApiError(422, 'Informe a URL base do n8n.')
  const baseUrl = normalizeN8nBaseUrl(await assertSafeN8nUrl(baseUrlValue))
  if (input.configuration.outboundWebhookUrl)
    await assertSafeN8nUrl(input.configuration.outboundWebhookUrl)

  const apiKey =
    input.configuration.apiKey ??
    (existing
      ? (
          await getIntegrationCredential({
            workspaceId: input.workspaceId,
            provider: 'n8n',
            credentialType: 'api_key',
            scopeKey: credentialScopes.apiKey(existing.id),
          })
        )?.value
      : undefined) ??
    env.N8N_API_KEY
  if (!apiKey) throw new ApiError(422, 'Informe uma API key do n8n.')

  const generatedSigningSecret = input.configuration.signingSecret
    ? null
    : existing
      ? null
      : randomBytes(32).toString('base64url')
  const signingSecret =
    input.configuration.signingSecret ??
    (existing
      ? (
          await getIntegrationCredential({
            workspaceId: input.workspaceId,
            provider: 'n8n',
            credentialType: 'api_key',
            scopeKey: credentialScopes.signingSecret(existing.id),
          })
        )?.value
      : undefined) ??
    env.N8N_WEBHOOK_SIGNING_SECRET ??
    generatedSigningSecret
  if (!signingSecret)
    throw new ApiError(422, 'Informe um segredo HMAC para os webhooks.')

  const connectionId = existing?.id ?? randomUUID()
  let probe: Awaited<ReturnType<typeof testN8nApi>>
  try {
    probe = await testN8nApi({ baseUrl, apiKey })
  } catch (error) {
    await writeIntegrationAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      provider: 'n8n',
      action: 'connection.validation',
      status: 'failure',
      resourceId: existing?.id,
      details: { host: sanitizedN8nHost(baseUrl) },
    })
    throw error
  }

  const { error: upsertError } = await admin
    .from('integration_connections')
    .upsert(
      {
        id: connectionId,
        workspace_id: input.workspaceId,
        provider: 'n8n',
        name: input.configuration.name,
        base_url: baseUrl,
        status: 'pending',
        event_subscriptions: input.configuration.eventSubscriptions,
        last_error: null,
        created_by: input.actorUserId,
      },
      { onConflict: 'workspace_id,provider' },
    )
  if (upsertError) throw upsertError

  await Promise.all([
    saveIntegrationCredential({
      workspaceId: input.workspaceId,
      provider: 'n8n',
      credentialType: 'api_key',
      scopeKey: credentialScopes.apiKey(connectionId),
      value: apiKey,
      metadata: { purpose: 'public_api' },
    }),
    saveIntegrationCredential({
      workspaceId: input.workspaceId,
      provider: 'n8n',
      credentialType: 'api_key',
      scopeKey: credentialScopes.signingSecret(connectionId),
      value: signingSecret,
      metadata: { purpose: 'webhook_hmac_sha256' },
    }),
    input.configuration.outboundWebhookUrl
      ? saveIntegrationCredential({
          workspaceId: input.workspaceId,
          provider: 'n8n',
          credentialType: 'api_key',
          scopeKey: credentialScopes.outboundUrl(connectionId),
          value: input.configuration.outboundWebhookUrl,
          metadata: { purpose: 'outbound_webhook_url' },
        })
      : Promise.resolve(),
  ])

  try {
    const validatedAt = new Date().toISOString()
    const { error } = await admin
      .from('integration_connections')
      .update({
        status: 'connected',
        detected_version: probe.version,
        last_validated_at: validatedAt,
        last_error: null,
      })
      .eq('workspace_id', input.workspaceId)
      .eq('id', connectionId)
    if (error) throw error
    await writeIntegrationAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      provider: 'n8n',
      action: existing ? 'connection.updated' : 'connection.created',
      status: 'success',
      resourceId: connectionId,
      details: { host: sanitizedN8nHost(baseUrl), version: probe.version },
    })
    return { connectionId, generatedSigningSecret, ...probe }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : 'Falha desconhecida.'
    await admin
      .from('integration_connections')
      .update({ status: 'error', last_error: message })
      .eq('workspace_id', input.workspaceId)
      .eq('id', connectionId)
    await writeIntegrationAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      provider: 'n8n',
      action: 'connection.validation',
      status: 'failure',
      resourceId: connectionId,
      details: { host: sanitizedN8nHost(baseUrl) },
    })
    throw error
  }
}

export async function getN8nConnection(
  workspaceId: string,
  admin = requireAdmin(),
) {
  const { data, error } = await admin
    .from('integration_connections')
    .select(
      'id,workspace_id,name,base_url,status,detected_version,event_subscriptions,last_validated_at,last_event_at,last_error,created_at',
    )
    .eq('workspace_id', workspaceId)
    .eq('provider', 'n8n')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getN8nConnectionById(
  connectionId: string,
  admin = requireAdmin(),
) {
  const { data, error } = await admin
    .from('integration_connections')
    .select(
      'id,workspace_id,name,base_url,status,detected_version,event_subscriptions,last_validated_at,last_event_at,last_error,created_at',
    )
    .eq('id', connectionId)
    .eq('provider', 'n8n')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function n8nCredentialPresence(
  workspaceId: string,
  connectionId: string,
  admin = requireAdmin(),
) {
  const { data, error } = await admin
    .from('integration_credentials')
    .select('scope_key')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'n8n')
    .eq('credential_type', 'api_key')
    .in('scope_key', [
      credentialScopes.apiKey(connectionId),
      credentialScopes.outboundUrl(connectionId),
      credentialScopes.signingSecret(connectionId),
    ])
  if (error) throw error
  const values = new Set(data.map((item) => item.scope_key))
  return {
    apiKey: values.has(credentialScopes.apiKey(connectionId)),
    outboundWebhook: values.has(credentialScopes.outboundUrl(connectionId)),
    signingSecret: values.has(credentialScopes.signingSecret(connectionId)),
  }
}

export async function disconnectN8nConnection(input: {
  workspaceId: string
  actorUserId: string
}) {
  const admin = requireAdmin()
  const connection = await getN8nConnection(input.workspaceId, admin)
  if (!connection) return false
  await Promise.all(
    [
      credentialScopes.apiKey(connection.id),
      credentialScopes.outboundUrl(connection.id),
      credentialScopes.signingSecret(connection.id),
    ].map((scopeKey) =>
      deleteIntegrationCredential({
        workspaceId: input.workspaceId,
        provider: 'n8n',
        credentialType: 'api_key',
        scopeKey,
      }),
    ),
  )
  const { error } = await admin
    .from('integration_connections')
    .delete()
    .eq('workspace_id', input.workspaceId)
    .eq('id', connection.id)
  if (error) throw error
  await writeIntegrationAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    provider: 'n8n',
    action: 'connection.disconnected',
    status: 'success',
    resourceId: connection.id,
  })
  return true
}

export async function probeStoredN8nConnection(workspaceId: string) {
  const admin = requireAdmin()
  const connection = await getN8nConnection(workspaceId, admin)
  if (!connection) throw new ApiError(404, 'Conexão n8n não encontrada.')
  const apiKey = await requiredCredential(
    workspaceId,
    credentialScopes.apiKey(connection.id),
  )
  const probe = await testN8nApi({ baseUrl: connection.base_url, apiKey })
  const { error } = await admin
    .from('integration_connections')
    .update({
      status: 'connected',
      detected_version: probe.version,
      last_validated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', connection.id)
  if (error) throw error
  return probe
}

export async function sendN8nEvent(input: {
  workspaceId: string
  eventType: N8nOutboundEventType
  payload: Record<string, unknown>
  deliveryId?: string
  fetcher?: typeof fetch
}) {
  const admin = requireAdmin()
  const connection = await getN8nConnection(input.workspaceId, admin)
  if (!connection || connection.status !== 'connected')
    throw new ApiError(409, 'A conexão n8n não está ativa.')
  if (
    input.eventType !== 'integration.test' &&
    !connection.event_subscriptions.includes(input.eventType)
  )
    return { skipped: true, reason: 'event_not_subscribed' as const }
  const [webhookUrl, signingSecret] = await Promise.all([
    requiredCredential(
      input.workspaceId,
      credentialScopes.outboundUrl(connection.id),
    ),
    requiredCredential(
      input.workspaceId,
      credentialScopes.signingSecret(connection.id),
    ),
  ])
  await assertSafeN8nUrl(webhookUrl)
  const deliveryId = input.deliveryId ?? randomUUID()
  const body = JSON.stringify({
    schemaVersion: 1,
    deliveryId,
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    workspace: { id: input.workspaceId },
    data: input.payload,
  })
  const hash = payloadSha256(body)
  const { error: insertError } = await admin
    .from('integration_webhook_deliveries')
    .insert({
      workspace_id: input.workspaceId,
      connection_id: connection.id,
      direction: 'outbound',
      delivery_id: deliveryId,
      event_type: input.eventType,
      status: 'processing',
      payload_hash: hash,
    })
  if (insertError?.code === '23505') {
    const { data: existing, error } = await admin
      .from('integration_webhook_deliveries')
      .select('status,payload_hash')
      .eq('connection_id', connection.id)
      .eq('direction', 'outbound')
      .eq('delivery_id', deliveryId)
      .single()
    if (error) throw error
    if (existing.payload_hash !== hash)
      throw new ApiError(409, 'Delivery ID já utilizado com outro conteúdo.')
    if (existing.status !== 'failed')
      return { skipped: true, reason: 'duplicate_delivery' as const }
    const { error: reopenError } = await admin
      .from('integration_webhook_deliveries')
      .update({
        status: 'processing',
        http_status: null,
        error_code: null,
        completed_at: null,
      })
      .eq('connection_id', connection.id)
      .eq('direction', 'outbound')
      .eq('delivery_id', deliveryId)
    if (reopenError) throw reopenError
  } else if (insertError) throw insertError

  let lastStatus: number | null = null
  let attempts = 0
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      attempts = attempt
      const timestamp = String(Math.floor(Date.now() / 1_000))
      let response: Response
      try {
        response = await (input.fetcher ?? fetch)(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WalChat-Delivery-Id': deliveryId,
            'X-WalChat-Event': input.eventType,
            'X-WalChat-Timestamp': timestamp,
            'X-WalChat-Webhook-Token': deriveN8nWebhookAuthToken(signingSecret),
            'X-WalChat-Signature-256': signN8nPayload(
              body,
              timestamp,
              signingSecret,
            ),
          },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
        })
      } catch (error) {
        if (attempt === 3) throw error
        await new Promise((resolve) => setTimeout(resolve, attempt * 250))
        continue
      }
      lastStatus = response.status
      if (response.ok) break
      if (![408, 429].includes(response.status) && response.status < 500)
        throw new ApiError(
          502,
          `Webhook n8n recusou o evento (${response.status}).`,
        )
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, attempt * 250))
    }
    if (!lastStatus || lastStatus < 200 || lastStatus >= 300)
      throw new ApiError(
        502,
        `Webhook n8n indisponível (${lastStatus ?? 'timeout'}).`,
      )
    await admin
      .from('integration_webhook_deliveries')
      .update({
        status: 'completed',
        attempt_count: attempts,
        http_status: lastStatus,
        completed_at: new Date().toISOString(),
      })
      .eq('connection_id', connection.id)
      .eq('direction', 'outbound')
      .eq('delivery_id', deliveryId)
    await admin
      .from('integration_connections')
      .update({ last_event_at: new Date().toISOString(), last_error: null })
      .eq('id', connection.id)
    return { deliveryId, status: lastStatus, attempts, skipped: false }
  } catch (error) {
    await admin
      .from('integration_webhook_deliveries')
      .update({
        status: 'failed',
        attempt_count: attempts,
        http_status: lastStatus,
        error_code: error instanceof Error ? error.name : 'unknown_error',
        completed_at: new Date().toISOString(),
      })
      .eq('connection_id', connection.id)
      .eq('direction', 'outbound')
      .eq('delivery_id', deliveryId)
    throw error
  }
}

export async function acceptN8nInboundDelivery(input: {
  connection: N8nConnectionRow
  deliveryId: string
  rawBody: string
}) {
  const admin = requireAdmin()
  const parsed = n8nInboundEventSchema.parse(
    JSON.parse(input.rawBody) as unknown,
  )
  const { error } = await admin.from('integration_webhook_deliveries').insert({
    workspace_id: input.connection.workspace_id,
    connection_id: input.connection.id,
    direction: 'inbound',
    delivery_id: input.deliveryId,
    event_type: parsed.eventType,
    status: 'processing',
    attempt_count: 1,
    payload_hash: payloadSha256(input.rawBody),
  })
  if (error?.code === '23505') {
    const { data: existing, error: lookupError } = await admin
      .from('integration_webhook_deliveries')
      .select('payload_hash,event_type')
      .eq('connection_id', input.connection.id)
      .eq('direction', 'inbound')
      .eq('delivery_id', input.deliveryId)
      .single()
    if (lookupError) throw lookupError
    if (
      existing.payload_hash !== payloadSha256(input.rawBody) ||
      existing.event_type !== parsed.eventType
    )
      throw new ApiError(409, 'Delivery ID já utilizado com outro conteúdo.')
    return { duplicate: true, event: parsed }
  }
  if (error) throw error
  return { duplicate: false, event: parsed }
}

export async function processN8nInboundEvent(input: {
  connection: N8nConnectionRow
  deliveryId: string
  event: N8nInboundEvent
}) {
  const admin = requireAdmin()
  try {
    const result =
      input.event.eventType === 'contact.upsert'
        ? await upsertN8nContact(admin, input.connection, input.event.data)
        : input.event.eventType === 'contact.tag.apply'
          ? await applyN8nTag(admin, input.connection, input.event.data)
          : await executeN8nAutomation(
              admin,
              input.connection,
              input.deliveryId,
              input.event.data,
            )
    await completeInbound(
      admin,
      input.connection.id,
      input.deliveryId,
      'completed',
    )
    await admin
      .from('integration_connections')
      .update({ last_event_at: new Date().toISOString(), last_error: null })
      .eq('id', input.connection.id)
    return result
  } catch (error) {
    await completeInbound(
      admin,
      input.connection.id,
      input.deliveryId,
      'failed',
      error instanceof Error ? error.name : 'unknown_error',
    )
    throw error
  }
}

export async function signingSecretForConnection(connection: N8nConnectionRow) {
  return requiredCredential(
    connection.workspace_id,
    credentialScopes.signingSecret(connection.id),
  )
}

async function upsertN8nContact(
  admin: AdminClient,
  connection: N8nConnectionRow,
  data: Extract<N8nInboundEvent, { eventType: 'contact.upsert' }>['data'],
) {
  const { data: link, error: linkError } = await admin
    .from('integration_contact_links')
    .select('contact_id')
    .eq('connection_id', connection.id)
    .eq('external_id', data.externalId)
    .maybeSingle()
  if (linkError) throw linkError
  let contactId = link?.contact_id as string | undefined
  if (!contactId && data.email) {
    const { data: contact, error } = await admin
      .from('contacts')
      .select('id')
      .eq('workspace_id', connection.workspace_id)
      .ilike('email', data.email)
      .maybeSingle()
    if (error) throw error
    contactId = contact?.id
  }
  if (!contactId && data.phone) {
    const { data: contact, error } = await admin
      .from('contacts')
      .select('id')
      .eq('workspace_id', connection.workspace_id)
      .eq('phone', data.phone)
      .maybeSingle()
    if (error) throw error
    contactId = contact?.id
  }
  const values = Object.fromEntries(
    Object.entries({
      full_name: data.fullName,
      display_name: data.fullName ?? data.email ?? data.phone,
      email: data.email?.toLowerCase(),
      phone: data.phone,
      company: data.company,
      job_title: data.jobTitle,
      lifecycle_stage: data.lifecycleStage,
      lead_score: data.leadScore,
      marketing_consent: data.marketingConsent,
      custom_fields: data.customFields,
    }).filter((entry) => entry[1] !== undefined),
  )
  if (data.marketingConsent) {
    Object.assign(values, {
      consent_source: 'n8n',
      consent_updated_at: new Date().toISOString(),
    })
  }
  if (contactId) {
    const { error } = await admin
      .from('contacts')
      .update(values)
      .eq('workspace_id', connection.workspace_id)
      .eq('id', contactId)
    if (error) throw error
  } else {
    if (!data.email && !data.phone)
      throw new ApiError(
        422,
        'Informe email ou telefone para criar um contato manual.',
      )
    const { data: created, error } = await admin
      .from('contacts')
      .insert({
        workspace_id: connection.workspace_id,
        platform: 'manual',
        instagram_user_id: null,
        lifecycle_stage: data.lifecycleStage ?? 'lead',
        lead_score: data.leadScore ?? 0,
        marketing_consent: data.marketingConsent ?? 'unknown',
        custom_fields: data.customFields ?? {},
        import_source: 'n8n',
        ...values,
      })
      .select('id')
      .single()
    if (error) throw error
    contactId = created.id
  }
  const { error: mapError } = await admin
    .from('integration_contact_links')
    .upsert(
      {
        workspace_id: connection.workspace_id,
        connection_id: connection.id,
        provider: 'n8n',
        external_id: data.externalId,
        contact_id: contactId,
      },
      { onConflict: 'connection_id,external_id' },
    )
  if (mapError) throw mapError
  return { contactId }
}

async function applyN8nTag(
  admin: AdminClient,
  connection: N8nConnectionRow,
  data: Extract<N8nInboundEvent, { eventType: 'contact.tag.apply' }>['data'],
) {
  const { data: link, error: linkError } = await admin
    .from('integration_contact_links')
    .select('contact_id')
    .eq('connection_id', connection.id)
    .eq('external_id', data.externalId)
    .maybeSingle()
  if (linkError) throw linkError
  if (!link)
    throw new ApiError(404, 'Contato externo ainda não foi sincronizado.')
  const { data: existingTag, error: tagLookupError } = await admin
    .from('tags')
    .select('id')
    .eq('workspace_id', connection.workspace_id)
    .ilike('name', data.tagName)
    .limit(1)
    .maybeSingle()
  if (tagLookupError) throw tagLookupError
  let tagId = existingTag?.id
  if (!tagId) {
    const { data: createdTag, error } = await admin
      .from('tags')
      .insert({
        workspace_id: connection.workspace_id,
        name: data.tagName,
        color: data.tagColor,
        is_automatic: true,
        description: 'Criada automaticamente pela integração n8n.',
      })
      .select('id')
      .single()
    if (error) throw error
    tagId = createdTag.id
  }
  const { error } = await admin.from('contact_tags').upsert(
    {
      workspace_id: connection.workspace_id,
      contact_id: link.contact_id,
      tag_id: tagId,
      source: 'system',
      metadata: { provider: 'n8n', externalId: data.externalId },
    },
    { onConflict: 'contact_id,tag_id' },
  )
  if (error) throw error
  return { contactId: link.contact_id, tagId }
}

async function executeN8nAutomation(
  admin: AdminClient,
  connection: N8nConnectionRow,
  deliveryId: string,
  data: Extract<N8nInboundEvent, { eventType: 'automation.execute' }>['data'],
) {
  const { data: contact, error } = await admin
    .from('contacts')
    .select('id,platform')
    .eq('workspace_id', connection.workspace_id)
    .eq('id', data.contactId)
    .maybeSingle()
  if (error) throw error
  if (!contact) throw new ApiError(404, 'Contato não encontrado no workspace.')
  if (contact.platform !== data.platform)
    throw new ApiError(422, 'O canal solicitado não corresponde ao contato.')
  return startAutomationExecution(
    {
      workspaceId: connection.workspace_id,
      flowId: data.flowId,
      contactId: data.contactId,
      platform: data.platform,
      idempotencyKey: `n8n:${connection.id}:${deliveryId}`,
      context: { ...data.context, source: 'n8n', connectionId: connection.id },
    },
    admin,
  )
}

async function completeInbound(
  admin: AdminClient,
  connectionId: string,
  deliveryId: string,
  status: 'completed' | 'failed',
  errorCode?: string,
) {
  const { error } = await admin
    .from('integration_webhook_deliveries')
    .update({
      status,
      error_code: errorCode ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('connection_id', connectionId)
    .eq('direction', 'inbound')
    .eq('delivery_id', deliveryId)
  if (error) throw error
}

async function requiredCredential(workspaceId: string, scopeKey: string) {
  const credential = await getIntegrationCredential({
    workspaceId,
    provider: 'n8n',
    credentialType: 'api_key',
    scopeKey,
  })
  if (!credential?.value)
    throw new ApiError(409, 'Credencial n8n ausente ou removida.')
  return credential.value
}

function requireAdmin() {
  const admin = getSupabaseAdmin()
  if (!admin) throw new ApiError(503, 'Backend Supabase indisponível.')
  return admin
}
