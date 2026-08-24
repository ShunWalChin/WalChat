#!/usr/bin/env node

/**
 * Executa somente leituras reais na Instagram API antes do Go-Live.
 * O relatório é propositalmente sanitizado: nunca imprime token, IDs, username,
 * payload de contato ou mensagens retornadas pelo provedor.
 */

import { createDecipheriv } from 'node:crypto'

const REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
]

const REQUIRED_WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_seen',
  'message_reactions',
  'comments',
  'live_comments',
  'mentions',
  'story_insights',
]

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Configuração obrigatória ausente: ${name}`)
  return value
}

function encryptionKey() {
  const encoded = requireEnv('CREDENTIALS_ENCRYPTION_KEY')
  const base64 = Buffer.from(encoded, 'base64')
  if (base64.length === 32) return base64
  const hex = Buffer.from(encoded, 'hex')
  if (hex.length === 32) return hex
  throw new Error('CREDENTIALS_ENCRYPTION_KEY possui formato inválido.')
}

function decryptCredential(envelope, context) {
  const [version, ivPart, tagPart, encryptedPart] = envelope.split('.')
  if (!['v1', 'v2'].includes(version) || !ivPart || !tagPart || !encryptedPart)
    throw new Error('Envelope de credencial inválido.')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivPart, 'base64url'),
  )
  if (version === 'v2')
    decipher.setAAD(
      Buffer.from(
        JSON.stringify([
          context.workspaceId,
          context.provider,
          context.credentialType,
          context.scopeKey,
        ]),
        'utf8',
      ),
    )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

async function supabaseRows(path) {
  const baseUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '')
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(`Consulta interna recusada (HTTP ${response.status}).`)
  return response.json()
}

async function graphRead(path, accessToken) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0'
  const response = await fetch(
    `https://graph.instagram.com/${version}/${path}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  )
  const payload = await response.json().catch(() => ({}))
  return {
    ok: response.ok && !payload?.error,
    status: response.status,
    code: typeof payload?.error?.code === 'number' ? payload.error.code : null,
    subcode:
      typeof payload?.error?.error_subcode === 'number'
        ? payload.error.error_subcode
        : null,
    payload,
  }
}

const accounts = await supabaseRows(
  'instagram_accounts?select=id,workspace_id,instagram_user_id,username,status,scopes,subscribed_fields,token_expires_at&status=eq.connected&order=created_at.asc',
)
const credentials = await supabaseRows(
  'integration_credentials?select=workspace_id,provider,credential_type,scope_key,encrypted_value,expires_at&provider=eq.meta&credential_type=eq.access_token',
)

const account = accounts.find((candidate) =>
  credentials.some(
    (credential) =>
      credential.workspace_id === candidate.workspace_id &&
      credential.scope_key === candidate.id,
  ),
)
if (!account)
  throw new Error('Nenhuma conta Instagram possui credencial ativa.')

const credential = credentials.find(
  (candidate) =>
    candidate.workspace_id === account.workspace_id &&
    candidate.scope_key === account.id,
)
const accessToken = decryptCredential(credential.encrypted_value, {
  workspaceId: account.workspace_id,
  provider: 'meta',
  credentialType: 'access_token',
  scopeKey: account.id,
})

const tokenNotExpired =
  !credential.expires_at ||
  new Date(credential.expires_at).getTime() > Date.now()
const storedScopesOk = REQUIRED_SCOPES.every((scope) =>
  (account.scopes || []).includes(scope),
)
const storedWebhookFieldsOk = REQUIRED_WEBHOOK_FIELDS.every((field) =>
  (account.subscribed_fields || []).includes(field),
)

const [profile, media, publishingLimit, subscriptions] = await Promise.all([
  graphRead('me?fields=user_id,username,account_type', accessToken),
  graphRead(
    `${encodeURIComponent(account.instagram_user_id)}/media?fields=id&limit=1`,
    accessToken,
  ),
  graphRead(
    `${encodeURIComponent(account.instagram_user_id)}/content_publishing_limit?fields=quota_usage,config`,
    accessToken,
  ),
  graphRead(
    `${encodeURIComponent(account.instagram_user_id)}/subscribed_apps`,
    accessToken,
  ),
])

const liveFields = Array.isArray(subscriptions.payload?.data)
  ? subscriptions.payload.data.flatMap((entry) => entry.subscribed_fields || [])
  : []
const liveWebhookFieldsOk = REQUIRED_WEBHOOK_FIELDS.every((field) =>
  liveFields.includes(field),
)
const profileIdentityMatches = Boolean(
  profile.ok &&
  String(profile.payload?.user_id || profile.payload?.id || '') ===
    String(account.instagram_user_id) &&
  profile.payload?.username === account.username,
)

const checks = {
  connectedAccounts: accounts.length,
  activeCredentialFound: Boolean(credential),
  tokenNotExpired,
  storedScopesOk,
  storedWebhookFieldsOk,
  profile: {
    ok: profile.ok,
    status: profile.status,
    code: profile.code,
    subcode: profile.subcode,
    identityMatches: profileIdentityMatches,
  },
  mediaRead: {
    ok: media.ok,
    status: media.status,
    code: media.code,
    subcode: media.subcode,
  },
  publishingLimitRead: {
    ok: publishingLimit.ok,
    status: publishingLimit.status,
    code: publishingLimit.code,
    subcode: publishingLimit.subcode,
  },
  webhookSubscriptionRead: {
    ok: subscriptions.ok,
    status: subscriptions.status,
    code: subscriptions.code,
    subcode: subscriptions.subcode,
    requiredFieldsPresent: liveWebhookFieldsOk,
  },
}

const ok = Boolean(
  tokenNotExpired &&
  storedScopesOk &&
  storedWebhookFieldsOk &&
  profile.ok &&
  profileIdentityMatches &&
  media.ok &&
  publishingLimit.ok &&
  subscriptions.ok &&
  liveWebhookFieldsOk,
)

console.log(JSON.stringify({ ok, checks }, null, 2))
process.exitCode = ok ? 0 : 1
