/** Runtime server-only do Google Ads OCI e Meta Conversions API. */
import '@tanstack/react-start/server-only'
import { createHash, randomUUID } from 'node:crypto'
import { ApiError } from './api-auth.server'
import type { z } from 'zod'
import { getServerEnv } from './env.server'
import {
  deleteIntegrationCredential,
  getIntegrationCredential,
  saveIntegrationCredential,
  writeIntegrationAudit,
} from './integration-credentials.server'
import { sendN8nEvent } from './n8n-integration.server'
import type {
  adConversionConfigurationSchema,
  adConversionRuleSchema,
} from './ad-conversions-contract'
import { getSupabaseAdmin } from './supabase-admin.server'

type Configuration = z.infer<typeof adConversionConfigurationSchema>
type Rule = z.infer<typeof adConversionRuleSchema>
type Provider = 'google_ads' | 'meta_capi'
type Admin = NonNullable<ReturnType<typeof getSupabaseAdmin>>

const TIMEOUT_MS = 15_000
const credentialScopes = {
  access: (id: string) => `access:${id}`,
  refresh: (id: string) => `refresh:${id}`,
  developer: (id: string) => `developer:${id}`,
  testEvent: (id: string) => `test-event:${id}`,
}

export class AdConversionDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly terminal: boolean,
    readonly httpStatus?: number,
    readonly requestId?: string | null,
  ) {
    super(code)
    this.name = 'AdConversionDeliveryError'
  }
}

function requireAdmin() {
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('Supabase administrativo indisponível.')
  return admin
}

function digits(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

export function sha256Identifier(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function normalizeEmailForAds(value: string) {
  return value.trim().toLowerCase()
}

export function normalizePhoneForAds(value: string) {
  const normalized = digits(value)
  return normalized ? `+${normalized}` : ''
}

function googleDateTime(value: string) {
  return new Date(value)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '+00:00')
}

function safeCode(value: unknown, fallback: string) {
  const normalized = String(value ?? fallback).replace(/[^A-Za-z0-9_.:-]/g, '_')
  return normalized.slice(0, 120) || fallback
}

async function fetchExternal(url: string, init: RequestInit) {
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new AdConversionDeliveryError('provider_network_error', false)
  }
}

async function connectionCredential(input: {
  workspaceId: string
  provider: Provider
  type: 'access_token' | 'refresh_token' | 'api_key'
  scope: string
}) {
  return (
    await getIntegrationCredential({
      workspaceId: input.workspaceId,
      provider: input.provider,
      credentialType: input.type,
      scopeKey: input.scope,
    })
  )?.value
}

async function googleAdsAccessToken(workspaceId: string, connectionId: string) {
  const stored = await getIntegrationCredential({
    workspaceId,
    provider: 'google_ads',
    credentialType: 'access_token',
    scopeKey: credentialScopes.access(connectionId),
  })
  if (
    stored?.value &&
    (!stored.expiresAt || Date.parse(stored.expiresAt) > Date.now() + 60_000)
  )
    return stored.value
  const refresh = await connectionCredential({
    workspaceId,
    provider: 'google_ads',
    type: 'refresh_token',
    scope: credentialScopes.refresh(connectionId),
  })
  const env = getServerEnv()
  if (!refresh || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new AdConversionDeliveryError('google_ads_reconnect_required', true)
  const response = await fetchExternal('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    error?: string
  }
  if (!response.ok || !payload.access_token)
    throw new AdConversionDeliveryError(
      safeCode(payload.error, 'google_ads_token_refresh_failed'),
      response.status < 500 && response.status !== 429,
      response.status,
    )
  await saveIntegrationCredential({
    workspaceId,
    provider: 'google_ads',
    credentialType: 'access_token',
    scopeKey: credentialScopes.access(connectionId),
    value: payload.access_token,
    expiresAt: new Date(
      Date.now() + (payload.expires_in ?? 3600) * 1_000,
    ).toISOString(),
  })
  return payload.access_token
}

async function googleHeaders(input: {
  workspaceId: string
  connection: Record<string, unknown>
}) {
  const id = String(input.connection.id)
  const developerToken = await connectionCredential({
    workspaceId: input.workspaceId,
    provider: 'google_ads',
    type: 'api_key',
    scope: credentialScopes.developer(id),
  })
  if (!developerToken)
    throw new AdConversionDeliveryError(
      'google_ads_developer_token_missing',
      true,
    )
  const token = await googleAdsAccessToken(input.workspaceId, id)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  }
  const manager = digits(String(input.connection.manager_account_id ?? ''))
  if (manager) headers['login-customer-id'] = manager
  return headers
}

export function buildGoogleClickConversion(input: {
  eventId: string
  eventTime: string
  customerId: string
  conversionActionId: string
  valueCents: number | null
  currency: string
  contact: { email?: string | null; phone?: string | null }
  attribution: Record<string, unknown>
}) {
  const click = input.attribution.gclid
    ? { gclid: input.attribution.gclid }
    : input.attribution.wbraid
      ? { wbraid: input.attribution.wbraid }
      : input.attribution.gbraid
        ? { gbraid: input.attribution.gbraid }
        : {}
  const userIdentifiers: Array<Record<string, string>> = []
  if (input.contact.email)
    userIdentifiers.push({
      hashedEmail: sha256Identifier(normalizeEmailForAds(input.contact.email)),
      userIdentifierSource: 'FIRST_PARTY',
    })
  if (input.contact.phone) {
    const phone = normalizePhoneForAds(input.contact.phone)
    if (phone)
      userIdentifiers.push({
        hashedPhoneNumber: sha256Identifier(phone),
        userIdentifierSource: 'FIRST_PARTY',
      })
  }
  return {
    conversionAction: `customers/${input.customerId}/conversionActions/${input.conversionActionId}`,
    conversionDateTime: googleDateTime(input.eventTime),
    orderId: input.eventId,
    ...(input.valueCents == null
      ? {}
      : {
          conversionValue: input.valueCents / 100,
          currencyCode: input.currency,
        }),
    ...click,
    ...(userIdentifiers.length ? { userIdentifiers } : {}),
    consent: { adUserData: 'GRANTED' },
  }
}

export function buildMetaConversion(input: {
  eventId: string
  eventName: string
  eventTime: string
  actionSource: string
  valueCents: number | null
  currency: string
  contactId: string
  contact: { email?: string | null; phone?: string | null }
  attribution: Record<string, unknown>
  clickTime?: string
}) {
  const isBusinessMessaging = input.actionSource === 'business_messaging'
  if (
    isBusinessMessaging &&
    (!input.attribution.ctwa_clid || !input.attribution.ctwa_waba_id)
  )
    throw new AdConversionDeliveryError('meta_ctwa_attribution_missing', true)
  const userData: Record<string, unknown> = isBusinessMessaging
    ? {
        ctwa_clid: input.attribution.ctwa_clid,
        whatsapp_business_account_id: input.attribution.ctwa_waba_id,
      }
    : { external_id: [sha256Identifier(input.contactId)] }
  if (!isBusinessMessaging) {
    if (input.contact.email)
      userData.em = [
        sha256Identifier(normalizeEmailForAds(input.contact.email)),
      ]
    if (input.contact.phone) {
      const phone = normalizePhoneForAds(input.contact.phone)
      if (phone) userData.ph = [sha256Identifier(phone)]
    }
    if (input.attribution.fbc) userData.fbc = input.attribution.fbc
    else if (input.attribution.fbclid)
      userData.fbc = `fb.1.${Date.parse(input.clickTime ?? input.eventTime)}.${input.attribution.fbclid}`
    if (input.attribution.fbp) userData.fbp = input.attribution.fbp
  }
  return {
    event_name: input.eventName,
    event_time: Math.floor(Date.parse(input.eventTime) / 1_000),
    event_id: input.eventId,
    action_source: input.actionSource,
    ...(isBusinessMessaging ? { messaging_channel: 'whatsapp' } : {}),
    ...(input.actionSource === 'website' && input.attribution.landing_url
      ? { event_source_url: input.attribution.landing_url }
      : {}),
    user_data: userData,
    ...(input.valueCents == null
      ? {}
      : {
          custom_data: {
            value: input.valueCents / 100,
            currency: input.currency,
            ...(input.eventName === 'Purchase'
              ? { order_id: input.eventId }
              : {}),
          },
        }),
  }
}

export async function configureAdConversionConnection(input: {
  workspaceId: string
  actorUserId: string
  configuration: Configuration
}) {
  const admin = requireAdmin()
  const provider = input.configuration.provider
  const current = await admin
    .from('ad_conversion_connections')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('provider', provider)
    .maybeSingle()
  if (current.error) throw current.error
  const id = current.data?.id ?? randomUUID()
  const accountId =
    provider === 'google_ads'
      ? digits(input.configuration.customerId)
      : digits(input.configuration.datasetId)
  const { error } = await admin.from('ad_conversion_connections').upsert(
    {
      id,
      workspace_id: input.workspaceId,
      provider,
      delivery_mode: input.configuration.deliveryMode,
      status: 'pending',
      account_id: accountId,
      manager_account_id:
        provider === 'google_ads'
          ? digits(input.configuration.managerCustomerId) || null
          : null,
      default_currency: input.configuration.defaultCurrency,
      api_version: 'v25',
      last_error: null,
      created_by: input.actorUserId,
    },
    { onConflict: 'workspace_id,provider' },
  )
  if (error) throw error
  if (provider === 'google_ads' && input.configuration.developerToken)
    await saveIntegrationCredential({
      workspaceId: input.workspaceId,
      provider,
      credentialType: 'api_key',
      scopeKey: credentialScopes.developer(id),
      value: input.configuration.developerToken,
      metadata: { purpose: 'google_ads_developer_token' },
    })
  if (provider === 'meta_capi' && input.configuration.accessToken)
    await saveIntegrationCredential({
      workspaceId: input.workspaceId,
      provider,
      credentialType: 'access_token',
      scopeKey: credentialScopes.access(id),
      value: input.configuration.accessToken,
      metadata: { purpose: 'meta_capi_access_token' },
    })
  if (provider === 'meta_capi' && input.configuration.testEventCode)
    await saveIntegrationCredential({
      workspaceId: input.workspaceId,
      provider,
      credentialType: 'api_key',
      scopeKey: credentialScopes.testEvent(id),
      value: input.configuration.testEventCode,
      metadata: { purpose: 'meta_test_event_code' },
    })
  if (provider === 'meta_capi' && input.configuration.clearTestEventCode)
    await deleteIntegrationCredential({
      workspaceId: input.workspaceId,
      provider,
      credentialType: 'api_key',
      scopeKey: credentialScopes.testEvent(id),
    })
  await writeIntegrationAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    provider,
    action: 'ad_conversion_connection.saved',
    status: 'success',
    resourceId: id,
    details: { deliveryMode: input.configuration.deliveryMode },
  })
  return { connectionId: id }
}

export async function testAdConversionConnection(input: {
  workspaceId: string
  actorUserId: string
  provider: Provider
}) {
  const admin = requireAdmin()
  const result = await admin
    .from('ad_conversion_connections')
    .select('*')
    .eq('workspace_id', input.workspaceId)
    .eq('provider', input.provider)
    .maybeSingle()
  if (result.error) throw result.error
  const connection = result.data
  if (!connection) throw new ApiError(404, 'Salve a configuração primeiro.')
  try {
    if (connection.delivery_mode === 'n8n') {
      const probeDelivery = await sendN8nEvent({
        workspaceId: input.workspaceId,
        eventType: 'conversion.ready',
        deliveryId: `ad-config-test-${randomUUID()}`,
        payload: { provider: input.provider, test: true, schemaVersion: 1 },
      })
      if (probeDelivery.skipped)
        throw new ApiError(
          422,
          'O evento conversion.ready não está ativo no n8n.',
        )
    } else if (input.provider === 'google_ads') {
      const headers = await googleHeaders({
        workspaceId: input.workspaceId,
        connection,
      })
      const customerId = digits(connection.account_id)
      if (!customerId)
        throw new AdConversionDeliveryError('google_ads_customer_missing', true)
      const response = await fetchExternal(
        `https://googleads.googleapis.com/${connection.api_version}/customers/${customerId}/googleAds:searchStream`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: 'SELECT customer.id FROM customer LIMIT 1',
          }),
        },
      )
      if (!response.ok)
        throw new AdConversionDeliveryError(
          `google_ads_http_${response.status}`,
          response.status < 500 && response.status !== 429,
          response.status,
          response.headers.get('request-id'),
        )
    } else {
      const token = await connectionCredential({
        workspaceId: input.workspaceId,
        provider: 'meta_capi',
        type: 'access_token',
        scope: credentialScopes.access(connection.id),
      })
      if (!token)
        throw new AdConversionDeliveryError('meta_capi_token_missing', true)
      const env = getServerEnv()
      const response = await fetchExternal(
        `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(connection.account_id)}?fields=id,name`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!response.ok)
        throw new AdConversionDeliveryError(
          `meta_capi_http_${response.status}`,
          response.status < 500 && response.status !== 429,
          response.status,
        )
    }
    await admin
      .from('ad_conversion_connections')
      .update({
        status: 'connected',
        last_validated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', connection.id)
      .eq('workspace_id', input.workspaceId)
    await writeIntegrationAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      provider: input.provider,
      action: 'ad_conversion_connection.validated',
      status: 'success',
      resourceId: connection.id,
    })
    return { ok: true }
  } catch (error) {
    const code =
      error instanceof AdConversionDeliveryError
        ? error.code
        : error instanceof ApiError
          ? 'n8n_validation_failed'
          : 'validation_failed'
    await admin
      .from('ad_conversion_connections')
      .update({ status: 'error', last_error: code })
      .eq('id', connection.id)
      .eq('workspace_id', input.workspaceId)
    await writeIntegrationAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      provider: input.provider,
      action: 'ad_conversion_connection.validated',
      status: 'failure',
      resourceId: connection.id,
      details: { code },
    })
    if (error instanceof ApiError) throw error
    throw new ApiError(422, `A validação falhou: ${code}.`)
  }
}

export async function disconnectAdConversionConnection(input: {
  workspaceId: string
  actorUserId: string
  provider: Provider
}) {
  const admin = requireAdmin()
  const found = await admin
    .from('ad_conversion_connections')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('provider', input.provider)
    .maybeSingle()
  if (found.error) throw found.error
  if (!found.data) return
  const scopes =
    input.provider === 'google_ads'
      ? [
          ['access_token', credentialScopes.access(found.data.id)],
          ['refresh_token', credentialScopes.refresh(found.data.id)],
          ['api_key', credentialScopes.developer(found.data.id)],
        ]
      : [
          ['access_token', credentialScopes.access(found.data.id)],
          ['api_key', credentialScopes.testEvent(found.data.id)],
        ]
  await Promise.all(
    scopes.map(([credentialType, scopeKey]) =>
      deleteIntegrationCredential({
        workspaceId: input.workspaceId,
        provider: input.provider,
        credentialType: credentialType as
          'access_token' | 'refresh_token' | 'api_key',
        scopeKey,
      }),
    ),
  )
  await admin
    .from('ad_conversion_connections')
    .update({ status: 'disconnected', last_error: null })
    .eq('id', found.data.id)
    .eq('workspace_id', input.workspaceId)
  await writeIntegrationAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    provider: input.provider,
    action: 'ad_conversion_connection.disconnected',
    status: 'success',
    resourceId: found.data.id,
  })
}

export async function saveAdConversionRule(input: {
  workspaceId: string
  actorUserId: string
  rule: Rule
}) {
  const admin = requireAdmin()
  const stage = await admin
    .from('crm_stages')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.rule.stageId)
    .maybeSingle()
  if (stage.error) throw stage.error
  if (!stage.data) throw new ApiError(404, 'Etapa do funil não encontrada.')
  const row = {
    workspace_id: input.workspaceId,
    stage_id: input.rule.stageId,
    name: input.rule.name,
    google_enabled: input.rule.googleEnabled,
    google_conversion_action_id: input.rule.googleConversionActionId ?? null,
    meta_enabled: input.rule.metaEnabled,
    meta_event_name: input.rule.metaEventName ?? null,
    meta_action_source: input.rule.metaActionSource,
    value_mode: input.rule.valueMode,
    fixed_value_cents: input.rule.fixedValueCents ?? null,
    currency: input.rule.currency,
    require_consent: input.rule.requireConsent,
    is_active: input.rule.isActive,
    created_by: input.actorUserId,
  }
  if (input.rule.id) {
    const updated = await admin
      .from('ad_conversion_rules')
      .update(row)
      .eq('id', input.rule.id)
      .eq('workspace_id', input.workspaceId)
      .select('id')
      .maybeSingle()
    if (updated.error) throw updated.error
    if (!updated.data) throw new ApiError(404, 'Regra não encontrada.')
    return updated.data
  }
  const saved = await admin
    .from('ad_conversion_rules')
    .upsert(row, { onConflict: 'workspace_id,stage_id' })
    .select('id')
    .single()
  if (saved.error) throw saved.error
  return saved.data
}

async function delivery(input: {
  admin: Admin
  workspaceId: string
  eventId: string
  provider: string
  attempt: number
  status: string
  httpStatus?: number | null
  requestId?: string | null
  errorCode?: string | null
  metadata?: Record<string, unknown>
}) {
  const { error } = await input.admin.from('ad_conversion_deliveries').upsert(
    {
      workspace_id: input.workspaceId,
      event_id: input.eventId,
      provider: input.provider,
      attempt: input.attempt,
      status: input.status,
      http_status: input.httpStatus ?? null,
      request_id: input.requestId ?? null,
      error_code: input.errorCode ?? null,
      response_metadata: input.metadata ?? {},
    },
    { onConflict: 'event_id,provider,attempt' },
  )
  if (error) throw error
}

async function sendGoogle(input: {
  workspaceId: string
  connection: Record<string, any>
  event: Record<string, any>
  rule: Record<string, any>
  contact: Record<string, any>
  attribution: Record<string, any>
}) {
  const headers = await googleHeaders({
    workspaceId: input.workspaceId,
    connection: input.connection,
  })
  const customerId = digits(input.connection.account_id)
  const conversion = buildGoogleClickConversion({
    eventId: input.event.id,
    eventTime: input.event.event_time,
    customerId,
    conversionActionId: input.rule.google_conversion_action_id,
    valueCents: input.event.value_cents,
    currency: input.event.currency,
    contact: input.contact,
    attribution: input.attribution,
  })
  const response = await fetchExternal(
    `https://googleads.googleapis.com/${input.connection.api_version}/customers/${customerId}:uploadClickConversions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversions: [conversion],
        partialFailure: true,
        validateOnly: false,
      }),
    },
  )
  const payload = (await response.json().catch(() => ({}))) as {
    partialFailureError?: { code?: number; message?: string }
    error?: { status?: string; code?: number }
    results?: unknown[]
  }
  const requestId = response.headers.get('request-id')
  if (!response.ok || payload.partialFailureError)
    throw new AdConversionDeliveryError(
      safeCode(
        payload.error?.status ?? payload.partialFailureError?.code,
        `google_ads_http_${response.status}`,
      ),
      response.ok || (response.status < 500 && response.status !== 429),
      response.status,
      requestId,
    )
  return {
    httpStatus: response.status,
    requestId,
    accepted: payload.results?.length ?? 1,
  }
}

async function sendMeta(input: {
  workspaceId: string
  connection: Record<string, any>
  event: Record<string, any>
  rule: Record<string, any>
  contact: Record<string, any>
  attribution: Record<string, any>
}) {
  const token = await connectionCredential({
    workspaceId: input.workspaceId,
    provider: 'meta_capi',
    type: 'access_token',
    scope: credentialScopes.access(input.connection.id),
  })
  if (!token)
    throw new AdConversionDeliveryError('meta_capi_token_missing', true)
  if (
    input.rule.meta_action_source === 'website' &&
    (!input.attribution.landing_url || !input.attribution.client_user_agent)
  )
    throw new AdConversionDeliveryError('meta_website_context_missing', true)
  const event = buildMetaConversion({
    eventId: input.event.id,
    eventName: input.rule.meta_event_name,
    eventTime: input.event.event_time,
    actionSource: input.rule.meta_action_source,
    valueCents: input.event.value_cents,
    currency: input.event.currency,
    contactId: input.event.contact_id,
    contact: input.contact,
    attribution: input.attribution,
    clickTime: input.attribution.first_touch_at,
  })
  if (
    input.rule.meta_action_source !== 'business_messaging' &&
    input.attribution.client_user_agent
  ) {
    event.user_data.client_user_agent = input.attribution.client_user_agent
  }
  const testEventCode = await connectionCredential({
    workspaceId: input.workspaceId,
    provider: 'meta_capi',
    type: 'api_key',
    scope: credentialScopes.testEvent(input.connection.id),
  })
  const env = getServerEnv()
  const response = await fetchExternal(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(input.connection.account_id)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [event],
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
      }),
    },
  )
  const payload = (await response.json().catch(() => ({}))) as {
    events_received?: number
    fbtrace_id?: string
    error?: { code?: number; error_subcode?: number; is_transient?: boolean }
  }
  if (!response.ok || !payload.events_received)
    throw new AdConversionDeliveryError(
      safeCode(
        payload.error?.error_subcode ?? payload.error?.code,
        `meta_capi_http_${response.status}`,
      ),
      payload.error?.is_transient === false ||
        (response.status < 500 && response.status !== 429),
      response.status,
      payload.fbtrace_id,
    )
  return {
    httpStatus: response.status,
    requestId: payload.fbtrace_id ?? null,
    accepted: payload.events_received,
  }
}

async function sendViaN8n(input: {
  workspaceId: string
  provider: Provider
  connection: Record<string, any>
  event: Record<string, any>
  rule: Record<string, any>
  contact: Record<string, any>
  attribution: Record<string, any>
}) {
  const data =
    input.provider === 'google_ads'
      ? buildGoogleClickConversion({
          eventId: input.event.id,
          eventTime: input.event.event_time,
          customerId: digits(input.connection.account_id),
          conversionActionId: input.rule.google_conversion_action_id,
          valueCents: input.event.value_cents,
          currency: input.event.currency,
          contact: input.contact,
          attribution: input.attribution,
        })
      : buildMetaConversion({
          eventId: input.event.id,
          eventName: input.rule.meta_event_name,
          eventTime: input.event.event_time,
          actionSource: input.rule.meta_action_source,
          valueCents: input.event.value_cents,
          currency: input.event.currency,
          contactId: input.event.contact_id,
          contact: input.contact,
          attribution: input.attribution,
          clickTime: input.attribution.first_touch_at,
        })
  const result = await sendN8nEvent({
    workspaceId: input.workspaceId,
    eventType: 'conversion.ready',
    deliveryId: `ad-${input.event.id}-${input.provider}`,
    occurredAt: input.event.event_time,
    payload: {
      schemaVersion: 1,
      provider: input.provider,
      accountId: input.connection.account_id,
      data,
    },
  })
  if (result.skipped && result.reason !== 'duplicate_delivery')
    throw new AdConversionDeliveryError(`n8n_${result.reason}`, true)
  return { httpStatus: 202, requestId: result.deliveryId ?? null, accepted: 1 }
}

/** Executa um evento de forma idempotente e retoma apenas provedores pendentes. */
export async function processAdConversionEvent(input: {
  workspaceId: string
  eventId: string
  jobAttempt: number
}) {
  const admin = requireAdmin()
  const result = await admin
    .from('ad_conversion_events')
    .select('*')
    .eq('id', input.eventId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (result.error) throw result.error
  const event = result.data
  if (!event || event.status === 'completed') return
  const [ruleResult, contactResult, attributionResult, connectionsResult] =
    await Promise.all([
      admin
        .from('ad_conversion_rules')
        .select('*')
        .eq('id', event.rule_id)
        .eq('workspace_id', input.workspaceId)
        .maybeSingle(),
      event.contact_id
        ? admin
            .from('contacts')
            .select('id,email,phone,marketing_consent')
            .eq('id', event.contact_id)
            .eq('workspace_id', input.workspaceId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      event.contact_id
        ? admin
            .from('contact_ad_attributions')
            .select('*')
            .eq('contact_id', event.contact_id)
            .eq('workspace_id', input.workspaceId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from('ad_conversion_connections')
        .select('*')
        .eq('workspace_id', input.workspaceId)
        .eq('status', 'connected'),
    ])
  if (
    ruleResult.error ||
    contactResult.error ||
    attributionResult.error ||
    connectionsResult.error
  )
    throw (
      ruleResult.error ??
      contactResult.error ??
      attributionResult.error ??
      connectionsResult.error
    )
  const rule = ruleResult.data
  const contact = contactResult.data
  const attribution = attributionResult.data
  if (!rule?.is_active || !contact || !attribution) {
    await admin
      .from('ad_conversion_events')
      .update({ status: 'blocked', error_code: 'conversion_data_missing' })
      .eq('id', event.id)
    return
  }
  const consentGranted =
    attribution.ad_user_data_consent === 'granted' ||
    contact.marketing_consent === 'granted'
  if (rule.require_consent && !consentGranted) {
    await admin
      .from('ad_conversion_events')
      .update({
        status: 'blocked',
        error_code: 'ad_user_data_consent_required',
      })
      .eq('id', event.id)
    return
  }
  const providers: Provider[] = [
    ...(rule.google_enabled ? (['google_ads'] as const) : []),
    ...(rule.meta_enabled ? (['meta_capi'] as const) : []),
  ]
  const previous = (event.provider_results ?? {}) as Record<string, any>
  const next = { ...previous }
  const attemptNumber = Number(event.attempts ?? 0) + 1
  const processing = await admin
    .from('ad_conversion_events')
    .update({
      status: 'processing',
      attempts: attemptNumber,
      error_code: null,
    })
    .eq('id', event.id)
    .eq('workspace_id', input.workspaceId)
  if (processing.error) throw processing.error
  let retryable: AdConversionDeliveryError | null = null
  for (const provider of providers) {
    if (previous[provider]?.status === 'completed') continue
    const connection = connectionsResult.data.find(
      (item) => item.provider === provider,
    )
    if (!connection) {
      next[provider] = { status: 'failed', errorCode: 'connection_not_ready' }
      continue
    }
    try {
      const response =
        connection.delivery_mode === 'n8n'
          ? await sendViaN8n({
              workspaceId: input.workspaceId,
              provider,
              connection,
              event,
              rule,
              contact,
              attribution,
            })
          : provider === 'google_ads'
            ? await sendGoogle({
                workspaceId: input.workspaceId,
                connection,
                event,
                rule,
                contact,
                attribution,
              })
            : await sendMeta({
                workspaceId: input.workspaceId,
                connection,
                event,
                rule,
                contact,
                attribution,
              })
      next[provider] = {
        status: 'completed',
        requestId: response.requestId,
        accepted: response.accepted,
      }
      await delivery({
        admin,
        workspaceId: input.workspaceId,
        eventId: event.id,
        provider,
        attempt: attemptNumber,
        status: 'completed',
        httpStatus: response.httpStatus,
        requestId: response.requestId,
        metadata: {
          accepted: response.accepted,
          route: connection.delivery_mode,
        },
      })
      await admin
        .from('ad_conversion_connections')
        .update({ last_event_at: new Date().toISOString(), last_error: null })
        .eq('id', connection.id)
    } catch (caught) {
      const failure =
        caught instanceof AdConversionDeliveryError
          ? caught
          : new AdConversionDeliveryError('provider_unexpected_error', false)
      const exhausted = input.jobAttempt >= 5
      next[provider] = {
        status: failure.terminal || exhausted ? 'failed' : 'retrying',
        errorCode: failure.code,
      }
      await delivery({
        admin,
        workspaceId: input.workspaceId,
        eventId: event.id,
        provider,
        attempt: attemptNumber,
        status: failure.terminal || exhausted ? 'failed' : 'retrying',
        httpStatus: failure.httpStatus,
        requestId: failure.requestId,
        errorCode: failure.code,
      })
      if (!failure.terminal && !exhausted) retryable = failure
    }
  }
  const states = providers.map((provider) => next[provider]?.status)
  const completed = states.filter((status) => status === 'completed').length
  const finalStatus = retryable
    ? 'pending'
    : completed === providers.length
      ? 'completed'
      : completed > 0
        ? 'partial'
        : 'failed'
  await admin
    .from('ad_conversion_events')
    .update({
      status: finalStatus,
      provider_results: next,
      attempts: attemptNumber,
      error_code:
        retryable?.code ??
        (completed === providers.length ? null : 'provider_delivery_failed'),
      processed_at: retryable ? null : new Date().toISOString(),
    })
    .eq('id', event.id)
    .eq('workspace_id', input.workspaceId)
  if (retryable) throw retryable
}

export async function credentialPresence(
  workspaceId: string,
  connection: Record<string, any>,
) {
  const admin = requireAdmin()
  const scopes =
    connection.provider === 'google_ads'
      ? [
          credentialScopes.refresh(connection.id),
          credentialScopes.developer(connection.id),
        ]
      : [
          credentialScopes.access(connection.id),
          credentialScopes.testEvent(connection.id),
        ]
  const result = await admin
    .from('integration_credentials')
    .select('credential_type,scope_key')
    .eq('workspace_id', workspaceId)
    .eq('provider', connection.provider)
    .in('scope_key', scopes)
  if (result.error) throw result.error
  const present = new Set(result.data.map((item) => item.scope_key))
  if (connection.provider === 'google_ads')
    return {
      oauth: present.has(credentialScopes.refresh(connection.id)),
      developerToken: present.has(credentialScopes.developer(connection.id)),
    }
  return {
    accessToken: present.has(credentialScopes.access(connection.id)),
    testEventCode: present.has(credentialScopes.testEvent(connection.id)),
  }
}

export const adCredentialScopes = credentialScopes
