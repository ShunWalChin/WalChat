/** Central operacional das conexões Meta e dos provedores de IA. */
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Instagram,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  Save,
  ShieldCheck,
  Unplug,
  Webhook,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ComplianceBanner,
  PageIntro,
  StatusDot,
  Switch,
} from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

type MetaAccount = {
  id: string
  username: string
  display_name: string | null
  account_type: 'BUSINESS' | 'CREATOR' | null
  status: 'connected' | 'expired' | 'disconnected'
  scopes: string[]
  subscribed_fields: string[]
  tokenStored: boolean
  tokenExpiresAt: string | null
  connection_error: string | null
}

type MetaStatus = {
  platformConfigured: boolean
  liveMode: boolean
  callbackUrl: string
  oauthRedirectUrl: string
  requiredScopes: string[]
  webhookFields: string[]
  accounts: MetaAccount[]
}

type AiStatus = {
  settings: {
    provider: 'openai' | 'google'
    model: string
    reasoningEffort: 'none' | 'low' | 'medium' | 'high'
    responseVerbosity: 'low' | 'medium' | 'high'
    maxOutputTokens: number
    isEnabled: boolean
  }
  providers: Record<
    'openai' | 'google',
    { configured: boolean; source: 'tenant' | 'server' | 'none' }
  >
}

export const Route = createFileRoute('/_app/configuracoes')({
  component: SettingsPage,
})

function SettingsPage() {
  const [meta, setMeta] = useState<MetaStatus | null>(null)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{
    tone: 'error' | 'success'
    text: string
  } | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const [metaStatus, aiStatus] = await Promise.all([
        apiFetch<MetaStatus>('/api/integrations/meta/status'),
        apiFetch<AiStatus>('/api/ai/settings'),
      ])
      setMeta(metaStatus)
      setAi(aiStatus)
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao carregar.',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
    const result = new URLSearchParams(window.location.search).get('meta')
    if (result === 'connected')
      setMessage({ tone: 'success', text: 'Instagram conectado com sucesso.' })
    if (result === 'denied')
      setMessage({ tone: 'error', text: 'A conexão foi cancelada na Meta.' })
    if (result === 'error')
      setMessage({
        tone: 'error',
        text: 'A Meta não concluiu a conexão. Inicie o fluxo novamente.',
      })
  }, [loadStatus])

  const activeAccount = useMemo(
    () =>
      meta?.accounts.find(
        (account) => account.status === 'connected' && account.tokenStored,
      ),
    [meta],
  )
  const metaWizardSteps = useMemo(() => {
    const scopesReady = Boolean(
      activeAccount &&
      meta?.requiredScopes.every((scope) =>
        activeAccount.scopes.includes(scope),
      ),
    )
    const webhooksReady = Boolean(
      activeAccount &&
      meta?.webhookFields.every((field) =>
        activeAccount.subscribed_fields.includes(field),
      ),
    )
    return [
      {
        label: 'Backend Meta',
        detail: 'App ID, App Secret, Verify Token e cofre',
        ready: Boolean(meta?.platformConfigured),
      },
      {
        label: 'Conta profissional',
        detail: activeAccount
          ? `@${activeAccount.username} com token cifrado`
          : 'OAuth Business/Creator ainda não concluído',
        ready: Boolean(activeAccount),
      },
      {
        label: 'Permissões',
        detail: scopesReady
          ? 'Todos os scopes concedidos'
          : 'Requer validação ou App Review',
        ready: scopesReady,
      },
      {
        label: 'Webhooks',
        detail: webhooksReady
          ? 'Campos assinados e validados'
          : 'Assinaturas ainda incompletas',
        ready: webhooksReady,
      },
      {
        label: 'Ambiente live',
        detail: meta?.liveMode
          ? 'Backend aceita ativação por workspace'
          : 'Servidor ainda está em modo demonstração',
        ready: Boolean(meta?.liveMode),
      },
    ]
  }, [activeAccount, meta])

  async function connectMeta() {
    setBusy('meta-connect')
    setMessage(null)
    try {
      const result = await apiFetch<{ authorizationUrl: string }>(
        '/api/integrations/meta/start',
        { method: 'POST' },
      )
      window.location.assign(result.authorizationUrl)
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao conectar.',
      })
      setBusy(null)
    }
  }

  async function validateMeta(accountId: string) {
    setBusy(`meta-validate-${accountId}`)
    try {
      const result = await apiFetch<{
        ok: boolean
        missingFields: string[]
      }>('/api/integrations/meta/validate', {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      })
      setMessage({
        tone: result.ok ? 'success' : 'error',
        text: result.ok
          ? 'Token, perfil e webhooks validados.'
          : `Campos de webhook ausentes: ${result.missingFields.join(', ')}`,
      })
      await loadStatus()
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao validar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function disconnectMeta(accountId: string) {
    if (!window.confirm('Desconectar esta conta e remover o token salvo?'))
      return
    setBusy(`meta-disconnect-${accountId}`)
    try {
      await apiFetch('/api/integrations/meta/disconnect', {
        method: 'DELETE',
        body: JSON.stringify({ accountId }),
      })
      setMessage({ tone: 'success', text: 'Conta desconectada com segurança.' })
      await loadStatus()
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao desconectar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function saveAiSettings() {
    if (!ai) return
    setBusy('ai-save')
    try {
      await apiFetch('/api/ai/settings', {
        method: 'PUT',
        body: JSON.stringify({ ...ai.settings, apiKey: apiKey || undefined }),
      })
      setApiKey('')
      setMessage({ tone: 'success', text: 'Configuração de IA salva.' })
      await loadStatus()
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar IA.',
      })
    } finally {
      setBusy(null)
    }
  }

  function copyWebhook() {
    if (!meta) return
    void navigator.clipboard.writeText(meta.callbackUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="Seu Wal Chat, bem amarrado."
        description="Conecte contas profissionais, valide webhooks e escolha o provedor dos agentes."
        actions={
          <button
            className="button button-dark"
            onClick={() => void saveAiSettings()}
            disabled={!ai || Boolean(busy)}
          >
            {busy === 'ai-save' ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            Salvar alterações
          </button>
        }
      />
      {message && (
        <div
          className={message.tone === 'error' ? 'form-error' : 'form-success'}
        >
          {message.tone === 'error' ? (
            <AlertTriangle size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          {message.text}
        </div>
      )}
      <section className="card meta-wizard" aria-labelledby="meta-wizard-title">
        <div className="card-head">
          <div>
            <span className="eyebrow">ASSISTENTE META</span>
            <h3 id="meta-wizard-title">Conexão em cinco etapas</h3>
          </div>
          <StatusDot
            tone={
              metaWizardSteps.every((step) => step.ready) ? 'green' : 'orange'
            }
          >
            {metaWizardSteps.filter((step) => step.ready).length}/5 concluídas
          </StatusDot>
        </div>
        <ol className="meta-wizard-steps">
          {metaWizardSteps.map((step, index) => (
            <li className={step.ready ? 'ready' : ''} key={step.label}>
              <span>{step.ready ? <CheckCircle2 size={17} /> : index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
            </li>
          ))}
        </ol>
        <div className="meta-wizard-actions">
          {!activeAccount ? (
            <button
              className="button button-orange"
              onClick={() => void connectMeta()}
              disabled={!meta?.platformConfigured || Boolean(busy)}
            >
              <ExternalLink size={15} /> Conectar Instagram
            </button>
          ) : (
            <button
              className="button button-outline"
              onClick={() => void validateMeta(activeAccount.id)}
              disabled={Boolean(busy)}
            >
              <RefreshCw size={15} /> Testar token e assinaturas
            </button>
          )}
          <a className="button button-dark" href="/operacoes">
            Abrir Central de Go-Live
          </a>
        </div>
      </section>
      <div className="settings-layout">
        <section className="stack-md">
          <article className="card settings-card">
            <div className="settings-head">
              <span className="settings-icon instagram">
                <Instagram size={22} />
              </span>
              <div>
                <h3>Instagram profissional</h3>
                {activeAccount ? (
                  <StatusDot tone="green">
                    Conectado como @{activeAccount.username}
                  </StatusDot>
                ) : (
                  <StatusDot tone="gray">Nenhuma conta conectada</StatusDot>
                )}
              </div>
              <button
                className="button button-outline"
                onClick={() => void connectMeta()}
                disabled={!meta?.platformConfigured || Boolean(busy)}
              >
                {busy === 'meta-connect' ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <ExternalLink size={14} />
                )}
                {activeAccount ? 'Conectar outra' : 'Conectar Instagram'}
              </button>
            </div>
            {!meta?.platformConfigured && (
              <p className="settings-warning">
                Configure META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN e
                CREDENTIALS_ENCRYPTION_KEY no backend.
              </p>
            )}
            {activeAccount && (
              <>
                <div className="permissions-grid">
                  {[
                    ['Mensagens', 'instagram_business_manage_messages'],
                    ['Comentários', 'instagram_business_manage_comments'],
                    ['Publicação', 'instagram_business_content_publish'],
                    ['Insights', 'instagram_business_manage_insights'],
                  ].map(([label, scope]) => {
                    const granted = activeAccount.scopes.includes(scope)
                    return (
                      <span className={granted ? '' : 'missing'} key={scope}>
                        {granted ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <AlertTriangle size={14} />
                        )}
                        {label}
                      </span>
                    )
                  })}
                </div>
                <div className="integration-actions">
                  <small>
                    Token{' '}
                    {activeAccount.tokenStored ? 'cifrado e salvo' : 'ausente'}
                    {activeAccount.tokenExpiresAt
                      ? ` · expira em ${new Date(activeAccount.tokenExpiresAt).toLocaleDateString('pt-BR')}`
                      : ''}
                  </small>
                  <button
                    className="button button-outline"
                    onClick={() => void validateMeta(activeAccount.id)}
                    disabled={Boolean(busy)}
                  >
                    <RefreshCw size={14} /> Validar
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() => void disconnectMeta(activeAccount.id)}
                    disabled={Boolean(busy)}
                  >
                    <Unplug size={14} /> Desconectar
                  </button>
                </div>
              </>
            )}
          </article>

          <article className="card settings-card">
            <div className="settings-head">
              <span className="settings-icon">
                <Webhook size={22} />
              </span>
              <div>
                <h3>Webhook da Meta</h3>
                <p>
                  {meta?.webhookFields.join(', ') ??
                    (loading
                      ? 'Carregando campos…'
                      : 'Disponível após autenticação.')}
                </p>
              </div>
            </div>
            <label>
              Callback URL
              <div className="copy-field">
                <input
                  value={
                    meta?.callbackUrl ??
                    (loading ? 'Carregando…' : 'Disponível após autenticação')
                  }
                  readOnly
                />
                <button onClick={copyWebhook} disabled={!meta}>
                  {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </label>
            <label>
              OAuth Redirect URI
              <div className="copy-field">
                <input
                  value={
                    meta?.oauthRedirectUrl ??
                    (loading ? 'Carregando…' : 'Disponível após autenticação')
                  }
                  readOnly
                />
              </div>
            </label>
            <label>
              Verify token
              <div className="secret-field">
                <input value="Configurado somente no backend" readOnly />
                <KeyRound size={16} />
              </div>
            </label>
          </article>

          <article className="card settings-card">
            <div className="settings-head">
              <span className="settings-icon blue">
                <PlugZap size={22} />
              </span>
              <div>
                <h3>Provedor de IA</h3>
                <p>OpenAI Responses API ou Gemini, isolados por workspace.</p>
              </div>
              <StatusDot
                tone={
                  ai?.providers[ai.settings.provider].configured
                    ? 'green'
                    : 'orange'
                }
              >
                {ai?.providers[ai.settings.provider].configured
                  ? 'Configurado'
                  : 'Chave pendente'}
              </StatusDot>
            </div>
            {ai && (
              <div className="settings-form-grid">
                <label>
                  Provedor
                  <select
                    value={ai.settings.provider}
                    onChange={(event) => {
                      const provider = event.target.value as 'openai' | 'google'
                      setAi({
                        ...ai,
                        settings: {
                          ...ai.settings,
                          provider,
                          model:
                            provider === 'openai'
                              ? 'gpt-5.6-sol'
                              : 'gemini-2.5-flash',
                        },
                      })
                    }}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="google">Google Gemini</option>
                  </select>
                </label>
                <label>
                  Modelo
                  <select
                    value={ai.settings.model}
                    onChange={(event) =>
                      setAi({
                        ...ai,
                        settings: { ...ai.settings, model: event.target.value },
                      })
                    }
                  >
                    {ai.settings.provider === 'openai' ? (
                      <>
                        <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
                        <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
                      </>
                    ) : (
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    )}
                  </select>
                </label>
                <label>
                  Esforço de raciocínio
                  <select
                    value={ai.settings.reasoningEffort}
                    disabled={ai.settings.provider !== 'openai'}
                    onChange={(event) =>
                      setAi({
                        ...ai,
                        settings: {
                          ...ai.settings,
                          reasoningEffort: event.target.value as
                            'none' | 'low' | 'medium' | 'high',
                        },
                      })
                    }
                  >
                    <option value="none">Nenhum</option>
                    <option value="low">Baixo</option>
                    <option value="medium">Médio</option>
                    <option value="high">Alto</option>
                  </select>
                </label>
                <label>
                  API key do workspace (opcional)
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Deixe vazio para usar a chave do servidor"
                    autoComplete="new-password"
                  />
                </label>
              </div>
            )}
          </article>
        </section>

        <aside className="stack-md">
          <ComplianceBanner />
          <article className="card safety-settings">
            <span className="eyebrow">PROTEÇÕES OBRIGATÓRIAS</span>
            <h3>Compliance por padrão</h3>
            {[
              ['Janela padrão de 24h', 'Bloqueia automação fora da janela'],
              ['HUMAN_AGENT até 7 dias', 'Somente atendimento humano aprovado'],
              ['Cooldown por gatilho', '24h por contato e gatilho'],
              ['Rodapé de opt-out', 'Adiciona “Responda PARAR”'],
              ['Blocklist de spam', 'Filtra conteúdo sensível'],
            ].map((item) => (
              <div className="safety-row" key={item[0]}>
                <span>
                  <strong>{item[0]}</strong>
                  <small>{item[1]}</small>
                </span>
                <Switch checked label={item[0]} />
              </div>
            ))}
          </article>
          <article className="card local-note">
            <ShieldCheck size={20} />
            <div>
              <strong>Secrets só no backend</strong>
              <p>
                Tokens da Meta e chaves de IA são cifrados antes do banco e
                nunca retornam para o navegador.
              </p>
            </div>
          </article>
        </aside>
      </div>
    </div>
  )
}
