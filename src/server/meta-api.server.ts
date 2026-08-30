/** Cliente oficial da Instagram Graph API with Instagram Login. */
import '@tanstack/react-start/server-only'
import { createHash, randomBytes } from 'node:crypto'
import { getInstagramAppConfig, getServerEnv } from './env.server'
import { getSupabaseAdmin } from './supabase-admin.server'

export const META_REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
] as const

export const META_WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_seen',
  'message_reactions',
  // Sem este campo, um link ig.me com origem abre a conversa mas o evento de
  // referral nunca chega — a captação funcionaria e a atribuição não.
  'messaging_referral',
  'comments',
  'live_comments',
  'mentions',
  'story_insights',
] as const

export const META_API_TIMEOUT_MS = 15_000

/**
 * A API do Instagram usa MEDIA_CREATOR para contas Creator, enquanto o banco
 * mantém o valor canônico CREATOR. Valores futuros/desconhecidos ficam nulos
 * para não romper a conexão por causa de uma classificação opcional.
 */
export function normalizeMetaAccountType(accountType?: string | null) {
  if (accountType === 'BUSINESS') return 'BUSINESS' as const
  if (accountType === 'CREATOR' || accountType === 'MEDIA_CREATOR')
    return 'CREATOR' as const
  return null
}

type MetaErrorPayload = {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(
      `A Meta recusou a operação (HTTP ${status}${code ? `, código ${code}` : ''}).`,
    )
    this.name = 'MetaApiError'
  }
}

/** Todas as chamadas Meta têm timeout e nunca propagam URL/token em erros de rede. */
async function fetchMeta(input: string | URL, init?: RequestInit) {
  try {
    return await fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(META_API_TIMEOUT_MS),
    })
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new MetaApiError(timeout ? 504 : 503)
  }
}

function graphBase() {
  return `https://graph.instagram.com/${getServerEnv().META_GRAPH_VERSION}`
}

function oauthRedirectUri() {
  const env = getServerEnv()
  return (
    env.META_OAUTH_REDIRECT_URI ??
    `${env.APP_ORIGIN}/api/integrations/meta/callback`
  )
}

async function parseMetaResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as MetaErrorPayload
  if (!response.ok || payload.error)
    throw new MetaApiError(
      response.status,
      payload.error?.code,
      payload.error?.error_subcode,
    )
  return payload as T
}

export function buildMetaAuthorizationUrl(state: string) {
  const env = getServerEnv()
  const app = getInstagramAppConfig(env)
  if (!app.appId || !app.appSecret)
    throw new Error(
      'META_INSTAGRAM_APP_ID e META_INSTAGRAM_APP_SECRET são obrigatórios.',
    )
  const url = new URL('https://www.instagram.com/oauth/authorize')
  url.searchParams.set('client_id', app.appId)
  url.searchParams.set('redirect_uri', oauthRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', META_REQUIRED_SCOPES.join(','))
  url.searchParams.set('state', state)
  url.searchParams.set('enable_fb_login', '0')
  url.searchParams.set('force_authentication', '1')
  return url.toString()
}

export async function createMetaOAuthState(input: {
  workspaceId: string
  userId: string
  redirectAfter?: string
}) {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase administrativo indisponível.')
  const state = randomBytes(32).toString('base64url')
  const stateHash = createHash('sha256').update(state).digest('hex')
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  await supabase
    .from('integration_oauth_states')
    .delete()
    .eq('provider', 'meta')
    .eq('user_id', input.userId)
    .lt('expires_at', new Date().toISOString())
  const { error } = await supabase.from('integration_oauth_states').insert({
    state_hash: stateHash,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    provider: 'meta',
    redirect_after: input.redirectAfter ?? '/configuracoes',
    expires_at: expiresAt,
  })
  if (error) throw error
  return { state, expiresAt }
}

/** Consome o state uma única vez; updates condicionais bloqueiam replay concorrente. */
export async function consumeMetaOAuthState(state: string) {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase administrativo indisponível.')
  const stateHash = createHash('sha256').update(state).digest('hex')
  const { data, error } = await supabase
    .from('integration_oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('state_hash', stateHash)
    .eq('provider', 'meta')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('workspace_id,user_id,redirect_after')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('State OAuth inválido, expirado ou já utilizado.')
  const { data: membership, error: membershipError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', data.workspace_id)
    .eq('user_id', data.user_id)
    .in('role', ['owner', 'admin'])
    .maybeSingle()
  if (membershipError) throw membershipError
  if (!membership)
    throw new Error('Usuário não possui mais permissão para conectar a Meta.')
  return data
}

export async function exchangeMetaAuthorizationCode(code: string) {
  const env = getServerEnv()
  const app = getInstagramAppConfig(env)
  if (!app.appId || !app.appSecret)
    throw new Error('Credenciais do aplicativo Instagram ausentes.')
  const form = new FormData()
  form.set('client_id', app.appId)
  form.set('client_secret', app.appSecret)
  form.set('grant_type', 'authorization_code')
  form.set('redirect_uri', oauthRedirectUri())
  form.set('code', code.replace(/#_$/, ''))
  const shortResponse = await fetchMeta(
    'https://api.instagram.com/oauth/access_token',
    { method: 'POST', body: form },
  )
  const shortToken = await parseMetaResponse<{
    access_token: string
    user_id: string | number
    permissions?: string[] | string
  }>(shortResponse)

  const longUrl = new URL('https://graph.instagram.com/access_token')
  longUrl.searchParams.set('grant_type', 'ig_exchange_token')
  longUrl.searchParams.set('client_secret', app.appSecret)
  longUrl.searchParams.set('access_token', shortToken.access_token)
  const longResponse = await fetchMeta(longUrl)
  const longToken = await parseMetaResponse<{
    access_token: string
    token_type?: string
    expires_in?: number
  }>(longResponse)
  return {
    accessToken: longToken.access_token,
    userId: String(shortToken.user_id),
    scopes: Array.isArray(shortToken.permissions)
      ? shortToken.permissions
      : typeof shortToken.permissions === 'string'
        ? shortToken.permissions.split(',').map((scope) => scope.trim())
        : [],
    expiresIn: longToken.expires_in ?? 60 * 24 * 60 * 60,
    tokenType: longToken.token_type ?? 'bearer',
  }
}

export async function getMetaOwnProfile(accessToken: string) {
  const url = new URL(`${graphBase()}/me`)
  url.searchParams.set(
    'fields',
    'user_id,username,name,profile_picture_url,account_type',
  )
  const response = await fetchMeta(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return parseMetaResponse<{
    id?: string
    user_id?: string
    username: string
    name?: string
    profile_picture_url?: string
    account_type?: 'BUSINESS' | 'CREATOR' | 'MEDIA_CREATOR'
  }>(response)
}

/** Lista mídia publicável da própria conta para configurar gatilhos por post. */
export async function getMetaMedia(input: {
  instagramUserId: string
  accessToken: string
  limit?: number
}) {
  const url = new URL(
    `${graphBase()}/${encodeURIComponent(input.instagramUserId)}/media`,
  )
  url.searchParams.set(
    'fields',
    'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp',
  )
  url.searchParams.set(
    'limit',
    String(Math.min(50, Math.max(1, input.limit ?? 25))),
  )
  const response = await fetchMeta(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  })
  return parseMetaResponse<{
    data?: Array<{
      id: string
      caption?: string
      media_type?: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
      media_product_type?: 'FEED' | 'REELS'
      media_url?: string
      thumbnail_url?: string
      permalink?: string
      timestamp?: string
    }>
  }>(response)
}

export type MetaPublishMedia = {
  url: string
  type: 'image' | 'video'
}

async function postMetaForm<T>(
  path: string,
  accessToken: string,
  values: Record<string, string>,
) {
  const body = new URLSearchParams(values)
  const response = await fetchMeta(`${graphBase()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  return parseMetaResponse<T>(response)
}

/**
 * Cria containers a partir de arquivos HTTPS públicos. A Meta busca esses
 * arquivos diretamente; o Wal Chat nunca recebe bytes nem tokens no browser.
 */
export async function createMetaPublishContainer(input: {
  instagramUserId: string
  accessToken: string
  kind: 'feed' | 'reel' | 'story' | 'carousel'
  caption?: string | null
  media: MetaPublishMedia[]
}) {
  const basePath = `/${encodeURIComponent(input.instagramUserId)}/media`
  if (input.kind === 'feed') {
    const media = input.media[0]
    if (input.media.length !== 1 || media.type !== 'image')
      throw new Error('Feed exige exatamente uma imagem pública.')
    return postMetaForm<{ id: string }>(basePath, input.accessToken, {
      image_url: media.url,
      caption: input.caption ?? '',
    })
  }
  if (input.kind === 'reel' || input.kind === 'story') {
    const media = input.media[0]
    if (input.media.length !== 1 || media.type !== 'video')
      throw new Error(
        `${input.kind === 'reel' ? 'Reel' : 'Story'} exige exatamente um vídeo público.`,
      )
    return postMetaForm<{ id: string }>(basePath, input.accessToken, {
      video_url: media.url,
      media_type: input.kind === 'reel' ? 'REELS' : 'STORIES',
      ...(input.kind === 'reel' ? { caption: input.caption ?? '' } : {}),
    })
  }
  if (input.media.length < 2 || input.media.length > 10)
    throw new Error('Carrossel exige de 2 a 10 mídias públicas.')
  const children: string[] = []
  for (const media of input.media) {
    const child = await postMetaForm<{ id: string }>(
      basePath,
      input.accessToken,
      media.type === 'video'
        ? {
            video_url: media.url,
            media_type: 'VIDEO',
            is_carousel_item: 'true',
          }
        : { image_url: media.url, is_carousel_item: 'true' },
    )
    children.push(child.id)
  }
  return postMetaForm<{ id: string }>(basePath, input.accessToken, {
    media_type: 'CAROUSEL',
    children: children.join(','),
    caption: input.caption ?? '',
  })
}

export async function getMetaContainerStatus(input: {
  containerId: string
  accessToken: string
}) {
  const url = new URL(`${graphBase()}/${encodeURIComponent(input.containerId)}`)
  url.searchParams.set('fields', 'status_code,status')
  const response = await fetchMeta(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  })
  return parseMetaResponse<{
    id: string
    status_code: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'
    status?: string
  }>(response)
}

export async function publishMetaContainer(input: {
  instagramUserId: string
  containerId: string
  accessToken: string
}) {
  return postMetaForm<{ id: string }>(
    `/${encodeURIComponent(input.instagramUserId)}/media_publish`,
    input.accessToken,
    { creation_id: input.containerId },
  )
}

export async function getMetaPublishingLimit(input: {
  instagramUserId: string
  accessToken: string
}) {
  const url = new URL(
    `${graphBase()}/${encodeURIComponent(input.instagramUserId)}/content_publishing_limit`,
  )
  url.searchParams.set('fields', 'quota_usage,config')
  const response = await fetchMeta(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  })
  return parseMetaResponse<{
    data?: Array<{
      quota_usage?: number
      config?: { quota_total?: number; quota_duration?: number }
    }>
  }>(response)
}

export type MetaInsightMetric = {
  name: string
  period?: string
  values?: Array<{ value: number | Record<string, unknown>; end_time?: string }>
  total_value?: { value?: number | Record<string, unknown> }
}

export async function getMetaAccountInsights(input: {
  instagramUserId: string
  accessToken: string
  metrics: string[]
  since?: string
  until?: string
}) {
  const url = new URL(
    `${graphBase()}/${encodeURIComponent(input.instagramUserId)}/insights`,
  )
  url.searchParams.set('metric', input.metrics.join(','))
  url.searchParams.set('period', 'day')
  if (input.since) url.searchParams.set('since', input.since)
  if (input.until) url.searchParams.set('until', input.until)
  const response = await fetchMeta(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  })
  return parseMetaResponse<{ data?: MetaInsightMetric[] }>(response)
}

export async function getMetaMediaInsights(input: {
  mediaId: string
  accessToken: string
  metrics: string[]
}) {
  const url = new URL(
    `${graphBase()}/${encodeURIComponent(input.mediaId)}/insights`,
  )
  url.searchParams.set('metric', input.metrics.join(','))
  const response = await fetchMeta(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  })
  return parseMetaResponse<{ data?: MetaInsightMetric[] }>(response)
}

export async function subscribeMetaWebhooks(input: {
  instagramUserId: string
  accessToken: string
}) {
  const response = await fetchMeta(
    `${graphBase()}/${encodeURIComponent(input.instagramUserId)}/subscribed_apps`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ subscribed_fields: META_WEBHOOK_FIELDS }),
    },
  )
  return parseMetaResponse<{ success: boolean }>(response)
}

export async function getMetaWebhookSubscriptions(input: {
  instagramUserId: string
  accessToken: string
}) {
  const response = await fetchMeta(
    `${graphBase()}/${encodeURIComponent(input.instagramUserId)}/subscribed_apps`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  )
  return parseMetaResponse<{
    data?: Array<{ id: string; subscribed_fields?: string[] }>
  }>(response)
}

export async function unsubscribeMetaWebhooks(input: {
  instagramUserId: string
  accessToken: string
}) {
  const response = await fetchMeta(
    `${graphBase()}/${encodeURIComponent(input.instagramUserId)}/subscribed_apps`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
  )
  return parseMetaResponse<{ success: boolean }>(response)
}

export async function refreshMetaAccessToken(accessToken: string) {
  const url = new URL('https://graph.instagram.com/refresh_access_token')
  url.searchParams.set('grant_type', 'ig_refresh_token')
  url.searchParams.set('access_token', accessToken)
  const response = await fetchMeta(url)
  return parseMetaResponse<{
    access_token: string
    token_type?: string
    expires_in?: number
  }>(response)
}
