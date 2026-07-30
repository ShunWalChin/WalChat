/** Persistência server-only de credenciais cifradas e trilha de auditoria. */
import '@tanstack/react-start/server-only'
import {
  decryptCredential,
  encryptCredential,
} from './credentials-crypto.server'
import { getServerEnv } from './env.server'
import { getSupabaseAdmin } from './supabase-admin.server'

type Provider = 'meta' | 'openai' | 'google'
type CredentialType = 'access_token' | 'api_key'

function requireAdmin() {
  const supabase = getSupabaseAdmin()
  if (!supabase)
    throw new Error('Supabase administrativo não está configurado.')
  return supabase
}

export async function saveIntegrationCredential(input: {
  workspaceId: string
  provider: Provider
  credentialType: CredentialType
  scopeKey: string
  value: string
  instagramAccountId?: string | null
  expiresAt?: string | null
  metadata?: Record<string, unknown>
}) {
  const supabase = requireAdmin()
  const { error } = await supabase.from('integration_credentials').upsert(
    {
      workspace_id: input.workspaceId,
      instagram_account_id: input.instagramAccountId ?? null,
      provider: input.provider,
      credential_type: input.credentialType,
      scope_key: input.scopeKey,
      encrypted_value: encryptCredential(input.value),
      expires_at: input.expiresAt ?? null,
      last_refreshed_at: new Date().toISOString(),
      metadata: input.metadata ?? {},
    },
    {
      onConflict: 'workspace_id,provider,credential_type,scope_key',
    },
  )
  if (error) throw error
}

export async function getIntegrationCredential(input: {
  workspaceId: string
  provider: Provider
  credentialType: CredentialType
  scopeKey: string
}) {
  const supabase = requireAdmin()
  const { data, error } = await supabase
    .from('integration_credentials')
    .select('encrypted_value,expires_at,metadata,last_refreshed_at')
    .eq('workspace_id', input.workspaceId)
    .eq('provider', input.provider)
    .eq('credential_type', input.credentialType)
    .eq('scope_key', input.scopeKey)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    value: decryptCredential(data.encrypted_value),
    expiresAt: data.expires_at as string | null,
    metadata: (data.metadata ?? {}) as Record<string, unknown>,
    lastRefreshedAt: data.last_refreshed_at as string | null,
  }
}

export async function deleteIntegrationCredential(input: {
  workspaceId: string
  provider: Provider
  credentialType: CredentialType
  scopeKey: string
}) {
  const { error } = await requireAdmin()
    .from('integration_credentials')
    .delete()
    .eq('workspace_id', input.workspaceId)
    .eq('provider', input.provider)
    .eq('credential_type', input.credentialType)
    .eq('scope_key', input.scopeKey)
  if (error) throw error
}

/** Resolve exclusivamente o token da conta em live; o fallback é restrito ao demo. */
export async function getMetaAccountAccess(input: {
  workspaceId: string
  instagramAccountId: string
}) {
  const supabase = requireAdmin()
  const { data: account, error } = await supabase
    .from('instagram_accounts')
    .select('id,instagram_user_id,status')
    .eq('id', input.instagramAccountId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (error) throw error
  if (!account || account.status !== 'connected')
    throw new Error('Conta do Instagram não está conectada.')

  const stored = await getIntegrationCredential({
    workspaceId: input.workspaceId,
    provider: 'meta',
    credentialType: 'access_token',
    scopeKey: account.id,
  })
  const env = getServerEnv()
  const accessToken =
    stored?.value ?? (env.DEMO_MODE === 'true' ? env.META_ACCESS_TOKEN : null)
  if (!accessToken)
    throw new Error('Token da conta Instagram não foi encontrado.')
  if (stored?.expiresAt && new Date(stored.expiresAt).getTime() <= Date.now())
    throw new Error('Token da conta Instagram expirou e precisa ser renovado.')
  return {
    accessToken,
    instagramUserId: account.instagram_user_id as string,
    expiresAt: stored?.expiresAt ?? null,
  }
}

/** Chave por workspace tem prioridade; a chave global viabiliza operação gerenciada. */
export async function getAiApiKey(
  workspaceId: string,
  provider: 'openai' | 'google',
) {
  const stored = await getIntegrationCredential({
    workspaceId,
    provider,
    credentialType: 'api_key',
    scopeKey: 'workspace',
  })
  if (stored?.value) return stored.value
  const env = getServerEnv()
  return provider === 'openai'
    ? env.OPENAI_API_KEY
    : env.GOOGLE_GENERATIVE_AI_API_KEY
}

export async function writeIntegrationAudit(input: {
  workspaceId: string
  actorUserId?: string | null
  provider: Provider
  action: string
  status: 'success' | 'failure'
  resourceId?: string | null
  details?: Record<string, unknown>
}) {
  const { error } = await requireAdmin()
    .from('integration_audit_logs')
    .insert({
      workspace_id: input.workspaceId,
      actor_user_id: input.actorUserId ?? null,
      provider: input.provider,
      action: input.action,
      status: input.status,
      resource_id: input.resourceId ?? null,
      details: input.details ?? {},
    })
  if (error) console.error('integration_audit_write_failed', error.message)
}
