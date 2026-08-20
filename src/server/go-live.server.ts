/** Diagnóstico e kill switches que separam uma configuração válida de um envio real. */
import '@tanstack/react-start/server-only'
import { hasValidCredentialEncryptionKey } from './credentials-crypto.server'
import { getServerEnv } from './env.server'
import { OutboundDeliveryError } from './outbound-delivery.server'
import { checkRuntimeReadiness } from './runtime-health.server'
import { getSupabaseAdmin } from './supabase-admin.server'
import { META_REQUIRED_SCOPES, META_WEBHOOK_FIELDS } from './meta-api.server'
import {
  WHATSAPP_REQUIRED_SCOPES,
  WHATSAPP_WEBHOOK_FIELDS,
} from './whatsapp-api.server'

export type GoLiveCheckStatus = 'pass' | 'fail' | 'warning'

export type GoLiveCheck = {
  id: string
  category: 'infra' | 'meta' | 'compliance' | 'ai' | 'operations'
  label: string
  status: GoLiveCheckStatus
  detail: string
  actionHref?: string
}

function check(
  id: string,
  category: GoLiveCheck['category'],
  label: string,
  passed: boolean,
  passDetail: string,
  failDetail: string,
  options?: { warning?: boolean; actionHref?: string },
): GoLiveCheck {
  return {
    id,
    category,
    label,
    status: passed ? 'pass' : options?.warning ? 'warning' : 'fail',
    detail: passed ? passDetail : failDetail,
    ...(options?.actionHref ? { actionHref: options.actionHref } : {}),
  }
}

/** Consolida dependências, conta Meta, credenciais e incidentes sem expor secrets. */
export async function getWorkspaceGoLiveStatus(workspaceId: string) {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase administrativo indisponível.')
  const env = getServerEnv()
  const readiness = await checkRuntimeReadiness()
  const now = new Date()
  const since24h = new Date(now.getTime() - 24 * 60 * 60_000).toISOString()

  const [
    { data: runtimeSettings, error: runtimeError },
    { data: accounts, error: accountsError },
    { data: whatsappAccounts, error: whatsappAccountsError },
    { data: metaCredentials, error: credentialsError },
    { data: aiSettings, error: aiSettingsError },
    { data: aiCredentials, error: aiCredentialsError },
    { data: calendarConnections, error: calendarConnectionsError },
    { count: failedWebhooks, error: webhookError },
    { count: unknownDeliveries, error: deliveriesError },
  ] = await Promise.all([
    supabase
      .from('workspace_runtime_settings')
      .select(
        'external_sends_enabled,comment_to_dm_enabled,autonomous_ai_enabled,activated_at',
      )
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('instagram_accounts')
      .select(
        'id,username,status,scopes,subscribed_fields,token_expires_at,permissions_validated_at,connection_error',
      )
      .eq('workspace_id', workspaceId)
      .order('created_at'),
    supabase
      .from('whatsapp_accounts')
      .select(
        'id,verified_name,display_phone_number,status,scopes,subscribed_fields,token_expires_at,permissions_validated_at,connection_error',
      )
      .eq('workspace_id', workspaceId)
      .order('created_at'),
    supabase
      .from('integration_credentials')
      .select('scope_key,expires_at')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'meta')
      .eq('credential_type', 'access_token'),
    supabase
      .from('ai_provider_settings')
      .select('provider,model,is_enabled')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('integration_credentials')
      .select('provider')
      .eq('workspace_id', workspaceId)
      .eq('credential_type', 'api_key'),
    supabase
      .from('calendar_connections')
      .select('id,account_email,status,last_sync_at,connection_error')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'google')
      .order('created_at'),
    supabase
      .from('webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'failed')
      .gte('received_at', since24h),
    supabase
      .from('outbound_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'unknown'),
  ])
  for (const error of [
    runtimeError,
    accountsError,
    whatsappAccountsError,
    credentialsError,
    aiSettingsError,
    aiCredentialsError,
    calendarConnectionsError,
    webhookError,
    deliveriesError,
  ])
    if (error) throw error

  const credentialByAccount = new Map(
    (metaCredentials ?? []).map((credential) => [
      credential.scope_key,
      credential.expires_at as string | null,
    ]),
  )
  const activeAccount = (accounts ?? []).find((account) => {
    const credentialExpiry = credentialByAccount.get(account.id)
    const expiry = credentialExpiry ?? account.token_expires_at
    return (
      account.status === 'connected' &&
      credentialByAccount.has(account.id) &&
      (!expiry || new Date(expiry).getTime() > now.getTime())
    )
  })
  const missingScopes = activeAccount
    ? META_REQUIRED_SCOPES.filter(
        (scope) => !(activeAccount.scopes ?? []).includes(scope),
      )
    : META_REQUIRED_SCOPES
  const missingWebhookFields = activeAccount
    ? META_WEBHOOK_FIELDS.filter(
        (field) => !(activeAccount.subscribed_fields ?? []).includes(field),
      )
    : META_WEBHOOK_FIELDS
  const activeWhatsApp = (whatsappAccounts ?? []).find((account) => {
    const credentialExpiry = credentialByAccount.get(account.id)
    const expiry = credentialExpiry ?? account.token_expires_at
    return (
      account.status === 'connected' &&
      credentialByAccount.has(account.id) &&
      (!expiry || new Date(expiry).getTime() > now.getTime())
    )
  })
  const missingWhatsAppScopes = activeWhatsApp
    ? WHATSAPP_REQUIRED_SCOPES.filter(
        (scope) => !(activeWhatsApp.scopes ?? []).includes(scope),
      )
    : []
  const missingWhatsAppFields = activeWhatsApp
    ? WHATSAPP_WEBHOOK_FIELDS.filter(
        (field) => !(activeWhatsApp.subscribed_fields ?? []).includes(field),
      )
    : []
  const anyMetaChannel = Boolean(activeAccount || activeWhatsApp)
  const connectedChannelPermissionsValid = Boolean(
    anyMetaChannel &&
    (!activeAccount || missingScopes.length === 0) &&
    (!activeWhatsApp || missingWhatsAppScopes.length === 0),
  )
  const connectedChannelWebhooksValid = Boolean(
    anyMetaChannel &&
    (!activeAccount || missingWebhookFields.length === 0) &&
    (!activeWhatsApp || missingWhatsAppFields.length === 0),
  )
  const selectedAiProvider = aiSettings?.provider ?? 'openai'
  const tenantAiConfigured = (aiCredentials ?? []).some(
    (credential) => credential.provider === selectedAiProvider,
  )
  const serverAiConfigured =
    selectedAiProvider === 'openai'
      ? Boolean(env.OPENAI_API_KEY)
      : Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY)
  const aiConfigured = Boolean(
    aiSettings?.is_enabled && (tenantAiConfigured || serverAiConfigured),
  )
  const activeGoogleCalendar = (calendarConnections ?? []).find(
    (connection) => connection.status === 'connected',
  )
  const googlePlatformConfigured = Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
  )

  const checks: GoLiveCheck[] = [
    check(
      'deployment_mode',
      'infra',
      'Backend em modo live',
      env.DEMO_MODE === 'false',
      'DEMO_MODE=false; chamadas externas podem ser liberadas por workspace.',
      'O servidor ainda está em DEMO_MODE=true e nunca fará chamadas externas.',
    ),
    check(
      'https_origin',
      'infra',
      'Origem HTTPS',
      env.APP_ORIGIN.startsWith('https://'),
      'APP_ORIGIN usa HTTPS.',
      'Configure APP_ORIGIN com o domínio HTTPS público.',
    ),
    check(
      'database',
      'infra',
      'Banco e RLS acessíveis',
      readiness.checks.supabase.status === 'up',
      `Supabase respondeu em ${readiness.checks.supabase.latencyMs} ms.`,
      'O probe do Supabase falhou.',
    ),
    check(
      'queue',
      'infra',
      'Fila Redis acessível',
      readiness.checks.redis.status === 'up',
      `Redis respondeu em ${readiness.checks.redis.latencyMs} ms.`,
      'Redis é obrigatório para webhooks e automações em live.',
    ),
    check(
      'credential_encryption',
      'compliance',
      'Cofre de credenciais',
      hasValidCredentialEncryptionKey(),
      'A chave de criptografia do backend é válida.',
      'Configure CREDENTIALS_ENCRYPTION_KEY com pelo menos 32 bytes.',
    ),
    check(
      'meta_platform',
      'meta',
      'Aplicativo Meta configurado',
      Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_VERIFY_TOKEN),
      'App ID, App Secret e Verify Token estão presentes.',
      'Faltam secrets do aplicativo Meta no backend.',
      { actionHref: '/configuracoes' },
    ),
    check(
      'meta_account',
      'meta',
      'Canal Meta conectado',
      anyMetaChannel,
      [
        activeAccount ? `Instagram @${activeAccount.username}` : null,
        activeWhatsApp
          ? `WhatsApp ${activeWhatsApp.display_phone_number ?? activeWhatsApp.verified_name ?? 'ativo'}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      'Conecte ao menos Instagram profissional ou WhatsApp Business.',
      { actionHref: '/configuracoes' },
    ),
    check(
      'meta_permissions',
      'meta',
      'Permissões aprovadas',
      connectedChannelPermissionsValid,
      'Todos os scopes dos canais conectados estão concedidos.',
      `Scopes ausentes: ${[
        ...(activeAccount
          ? missingScopes.map((scope) => `Instagram/${scope}`)
          : []),
        ...missingWhatsAppScopes.map((scope) => `WhatsApp/${scope}`),
      ].join(', ')}`,
      { actionHref: '/configuracoes' },
    ),
    check(
      'meta_webhooks',
      'meta',
      'Webhooks assinados',
      connectedChannelWebhooksValid,
      'Todos os webhooks dos canais conectados estão assinados.',
      `Campos ausentes: ${[
        ...(activeAccount
          ? missingWebhookFields.map((field) => `Instagram/${field}`)
          : []),
        ...missingWhatsAppFields.map((field) => `WhatsApp/${field}`),
      ].join(', ')}`,
      { actionHref: '/configuracoes' },
    ),
    check(
      'ambiguous_deliveries',
      'operations',
      'Entregas sem ambiguidade',
      (unknownDeliveries ?? 0) === 0,
      'Nenhum envio exige conciliação manual.',
      `${unknownDeliveries ?? 0} envio(s) com resultado desconhecido precisam de revisão.`,
    ),
    check(
      'webhook_failures',
      'operations',
      'Webhooks das últimas 24h',
      (failedWebhooks ?? 0) === 0,
      'Nenhuma falha recente de processamento.',
      `${failedWebhooks ?? 0} evento(s) falharam nas últimas 24h.`,
      { warning: true, actionHref: '/operacoes' },
    ),
    check(
      'ai_provider',
      'ai',
      'Provedor do copiloto',
      aiConfigured,
      `${selectedAiProvider} está habilitado e possui credencial.`,
      'Configure a chave do provedor para liberar sugestões reais.',
      { warning: true, actionHref: '/configuracoes' },
    ),
    check(
      'google_calendar',
      'operations',
      'Google Agenda e Meet',
      googlePlatformConfigured && Boolean(activeGoogleCalendar),
      `Agenda conectada${activeGoogleCalendar?.account_email ? ` a ${activeGoogleCalendar.account_email}` : ''}.`,
      googlePlatformConfigured
        ? 'Conecte uma conta Google para sincronizar agenda, tarefas e Meet.'
        : 'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no backend.',
      { warning: true, actionHref: '/calendario' },
    ),
  ]
  const criticalFailures = checks.filter((item) => item.status === 'fail')
  const settings = {
    externalSendsEnabled: runtimeSettings?.external_sends_enabled ?? false,
    commentToDmEnabled: runtimeSettings?.comment_to_dm_enabled ?? false,
    autonomousAiEnabled: runtimeSettings?.autonomous_ai_enabled ?? false,
    activatedAt: runtimeSettings?.activated_at ?? null,
  }
  return {
    checks,
    summary: {
      passed: checks.filter((item) => item.status === 'pass').length,
      warnings: checks.filter((item) => item.status === 'warning').length,
      failed: criticalFailures.length,
      total: checks.length,
    },
    canEnableExternalSends: criticalFailures.length === 0,
    settings,
    activeAccount: activeAccount
      ? { id: activeAccount.id, username: activeAccount.username }
      : null,
    activeWhatsApp: activeWhatsApp
      ? {
          id: activeWhatsApp.id,
          name: activeWhatsApp.verified_name,
          phone: activeWhatsApp.display_phone_number,
        }
      : null,
    generatedAt: now.toISOString(),
  }
}

/** O gate por workspace é verificado imediatamente antes de qualquer I/O com a Meta. */
export async function assertWorkspaceExternalSendsEnabled(workspaceId: string) {
  if (getServerEnv().DEMO_MODE === 'true') return
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase administrativo indisponível.')
  const { data, error } = await supabase
    .from('workspace_runtime_settings')
    .select('external_sends_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw error
  if (!data?.external_sends_enabled)
    throw new OutboundDeliveryError(
      'external_sends_disabled',
      'Disparos externos estão bloqueados na Central de Go-Live.',
      423,
    )
}
