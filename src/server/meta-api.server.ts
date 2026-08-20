/** Cliente oficial da Instagram Graph API with Instagram Login. */
import '@tanstack/react-start/server-only'
import { createHash, randomBytes } from 'node:crypto'
import { getServerEnv } from './env.server'
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
  'comments',
  'live_comments',
  'mentions',
  'story_insights',
] as const

export const META_API_TIMEOUT_MS = 15_000

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
  if (!env.META_APP_ID || !env.META_APP_SECRET)
    throw new Error('META_APP_ID e META_APP_SECRET são obrigatórios.')
  const url = new URL('https://www.instagram.com/oauth/authorize')
  url.searchParams.set('client_id', env.META_APP_ID)
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
  return data
}

export async function exchangeMetaAuthorizationCode(code: string) {
  const env = getServerEnv()
  if (!env.META_APP_ID || !env.META_APP_SECRET)
    throw new Error('Credenciais do aplicativo Meta ausentes.')
  const form = new FormData()
  form.set('client_id', env.META_APP_ID)
  form.set('client_secret', env.META_APP_SECRET)
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
  longUrl.searchParams.set('client_secret', env.META_APP_SECRET)
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
    account_type?: 'BUSINESS' | 'CREATOR'
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
