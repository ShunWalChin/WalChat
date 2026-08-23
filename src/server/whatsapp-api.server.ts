/** Cliente server-only da WhatsApp Cloud API e do Embedded Signup oficial. */
import '@tanstack/react-start/server-only'
import { createHmac } from 'node:crypto'
import { getServerEnv, getWhatsAppAppConfig } from './env.server'

export const WHATSAPP_REQUIRED_SCOPES = [
  'business_management',
  'whatsapp_business_management',
  'whatsapp_business_messaging',
] as const

export const WHATSAPP_WEBHOOK_FIELDS = ['messages'] as const
export const WHATSAPP_API_TIMEOUT_MS = 15_000

type GraphErrorPayload = {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

/** Erros sanitizados nunca carregam token, telefone ou o payload original. */
export class WhatsAppApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(
      `A Meta recusou a operação do WhatsApp (HTTP ${status}${code ? `, código ${code}` : ''}).`,
    )
    this.name = 'MetaApiError'
  }
}

function graphBase() {
  return `https://graph.facebook.com/${getServerEnv().META_GRAPH_VERSION}`
}

function appSecretProof(accessToken: string) {
  const secret = getWhatsAppAppConfig().appSecret
  if (!secret) throw new Error('META_WHATSAPP_APP_SECRET não configurado.')
  return createHmac('sha256', secret).update(accessToken).digest('hex')
}

async function fetchGraph(input: string | URL, init?: RequestInit) {
  try {
    return await fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(WHATSAPP_API_TIMEOUT_MS),
    })
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new WhatsAppApiError(timeout ? 504 : 503)
  }
}

async function parseGraphResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as GraphErrorPayload
  if (!response.ok || payload.error)
    throw new WhatsAppApiError(
      response.status,
      payload.error?.code,
      payload.error?.error_subcode,
    )
  return payload as T
}

function withProof(path: string, accessToken: string) {
  const url = new URL(`${graphBase()}/${path.replace(/^\//, '')}`)
  url.searchParams.set('appsecret_proof', appSecretProof(accessToken))
  return url
}

function bearer(accessToken: string, json = false) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

/** Troca o código efêmero retornado pelo Facebook Login for Business. */
export async function exchangeWhatsAppEmbeddedSignupCode(code: string) {
  const env = getServerEnv()
  const app = getWhatsAppAppConfig(env)
  if (!app.appId || !app.appSecret)
    throw new Error('Credenciais do aplicativo WhatsApp ausentes.')
  const url = new URL(`${graphBase()}/oauth/access_token`)
  url.searchParams.set('client_id', app.appId)
  url.searchParams.set('client_secret', app.appSecret)
  url.searchParams.set('code', code.replace(/#_$/, ''))
  const response = await fetchGraph(url)
  return parseGraphResponse<{
    access_token: string
    token_type?: string
    expires_in?: number
  }>(response)
}

/** Confirma app, validade, expiração, scopes e WABAs concedidas ao token. */
export async function debugWhatsAppAccessToken(accessToken: string) {
  const env = getServerEnv()
  const app = getWhatsAppAppConfig(env)
  if (!app.appId || !app.appSecret)
    throw new Error('Credenciais do aplicativo WhatsApp ausentes.')
  const url = new URL(`${graphBase()}/debug_token`)
  url.searchParams.set('input_token', accessToken)
  const response = await fetchGraph(url, {
    headers: {
      Authorization: `Bearer ${app.appId}|${app.appSecret}`,
    },
  })
  return parseGraphResponse<{
    data: {
      app_id?: string
      user_id?: string
      is_valid?: boolean
      expires_at?: number
      data_access_expires_at?: number
      scopes?: string[]
      granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>
    }
  }>(response)
}

export async function getWhatsAppBusinessAccount(input: {
  wabaId: string
  accessToken: string
}) {
  const url = withProof(input.wabaId, input.accessToken)
  url.searchParams.set(
    'fields',
    'id,name,currency,timezone_id,message_template_namespace',
  )
  const response = await fetchGraph(url, {
    headers: bearer(input.accessToken),
  })
  return parseGraphResponse<{
    id: string
    name?: string
    currency?: string
    timezone_id?: string
    message_template_namespace?: string
  }>(response)
}

/** Lista o telefone pela WABA para provar que o ID informado pertence a ela. */
export async function getWhatsAppPhoneNumber(input: {
  wabaId: string
  phoneNumberId: string
  accessToken: string
}) {
  const url = withProof(`${input.wabaId}/phone_numbers`, input.accessToken)
  url.searchParams.set(
    'fields',
    'id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status',
  )
  url.searchParams.set('limit', '100')
  const response = await fetchGraph(url, {
    headers: bearer(input.accessToken),
  })
  const payload = await parseGraphResponse<{
    data?: Array<{
      id: string
      display_phone_number?: string
      verified_name?: string
      quality_rating?: string
      code_verification_status?: string
      name_status?: string
    }>
  }>(response)
  const phone = payload.data?.find((item) => item.id === input.phoneNumberId)
  if (!phone) throw new Error('Telefone não pertence à WABA autorizada.')
  return phone
}

export async function subscribeWhatsAppBusinessAccount(input: {
  wabaId: string
  accessToken: string
}) {
  const response = await fetchGraph(
    withProof(`${input.wabaId}/subscribed_apps`, input.accessToken),
    {
      method: 'POST',
      headers: bearer(input.accessToken, true),
      body: JSON.stringify({}),
    },
  )
  return parseGraphResponse<{ success: boolean }>(response)
}

export async function getWhatsAppBusinessAccountSubscriptions(input: {
  wabaId: string
  accessToken: string
}) {
  const response = await fetchGraph(
    withProof(`${input.wabaId}/subscribed_apps`, input.accessToken),
    {
      headers: bearer(input.accessToken),
    },
  )
  return parseGraphResponse<{ data?: Array<Record<string, unknown>> }>(response)
}

export async function unsubscribeWhatsAppBusinessAccount(input: {
  wabaId: string
  accessToken: string
}) {
  const response = await fetchGraph(
    withProof(`${input.wabaId}/subscribed_apps`, input.accessToken),
    {
      method: 'DELETE',
      headers: bearer(input.accessToken),
    },
  )
  return parseGraphResponse<{ success: boolean }>(response)
}

/** O PIN é usado somente na chamada e nunca é persistido. */
export async function registerWhatsAppPhoneNumber(input: {
  phoneNumberId: string
  accessToken: string
  pin: string
}) {
  const response = await fetchGraph(
    withProof(`${input.phoneNumberId}/register`, input.accessToken),
    {
      method: 'POST',
      headers: bearer(input.accessToken, true),
      body: JSON.stringify({ messaging_product: 'whatsapp', pin: input.pin }),
    },
  )
  return parseGraphResponse<{ success: boolean | string }>(response)
}

export type WhatsAppTemplate = {
  id?: string
  name: string
  language: string
  category?: string
  status: string
  parameter_format?: string
  components?: unknown[]
  rejected_reason?: string
}

export async function getWhatsAppMessageTemplates(input: {
  wabaId: string
  accessToken: string
}) {
  const templates: WhatsAppTemplate[] = []
  let after: string | undefined
  // O cursor é reconstruído localmente; nunca seguimos uma URL arbitrária
  // retornada pelo provedor e limitamos páginas para evitar loops externos.
  for (let page = 0; page < 20; page++) {
    const url = withProof(
      `${input.wabaId}/message_templates`,
      input.accessToken,
    )
    url.searchParams.set(
      'fields',
      'id,name,language,category,status,parameter_format,components,rejected_reason',
    )
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after', after)
    const response = await fetchGraph(url, {
      headers: bearer(input.accessToken),
    })
    const payload = await parseGraphResponse<{
      data?: WhatsAppTemplate[]
      paging?: { cursors?: { after?: string }; next?: string }
    }>(response)
    templates.push(...(payload.data ?? []))
    after = payload.paging?.next ? payload.paging.cursors?.after : undefined
    if (!after) break
  }
  return { data: templates }
}

export async function getWhatsAppMediaMetadata(input: {
  mediaId: string
  accessToken: string
}) {
  const url = withProof(input.mediaId, input.accessToken)
  url.searchParams.set('fields', 'id,url,mime_type,sha256,file_size')
  const response = await fetchGraph(url, {
    headers: bearer(input.accessToken),
  })
  return parseGraphResponse<{
    id: string
    url: string
    mime_type?: string
    sha256?: string
    file_size?: number
  }>(response)
}

export function whatsappTokenTargetsWaba(
  granularScopes: Array<{ scope?: string; target_ids?: string[] }> | undefined,
  wabaId: string,
) {
  return Boolean(
    granularScopes?.some(
      (item) =>
        item.scope === 'whatsapp_business_management' &&
        item.target_ids?.includes(wabaId),
    ),
  )
}

/** Confirma que a assinatura consultada pertence ao aplicativo Wal Chat. */
export function whatsappSubscriptionsIncludeApp(
  subscriptions: Array<Record<string, unknown>> | undefined,
  appId: string,
) {
  return Boolean(
    subscriptions?.some((subscription) => {
      if (String(subscription.id ?? '') === appId) return true
      for (const key of ['app', 'whatsapp_business_api_data']) {
        const nested = subscription[key]
        if (
          nested &&
          typeof nested === 'object' &&
          String((nested as Record<string, unknown>).id ?? '') === appId
        )
          return true
      }
      return false
    }),
  )
}
