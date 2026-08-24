/** Wizard operacional para conectar e validar serviços externos do workspace. */
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Instagram,
  LoaderCircle,
  MessageCircle,
  PlugZap,
  RefreshCw,
  Send,
  ShieldCheck,
  Unplug,
  Webhook,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageIntro, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

type ProviderKey = 'instagram' | 'whatsapp' | 'google' | 'ai' | 'n8n'
type MetaStatus = {
  platformConfigured: boolean
  accounts: Array<{ status: string; tokenStored: boolean }>
  whatsapp: {
    embeddedSignupConfigured: boolean
    accounts: Array<{ status: string; tokenStored: boolean }>
  }
}
type GoogleStatus = {
  platformConfigured: boolean
  connections: Array<{ status: string; tokenStored: boolean }>
}
type AiStatus = {
  settings: { provider: 'openai' | 'google'; isEnabled: boolean }
  providers: Record<'openai' | 'google', { configured: boolean }>
}
type N8nStatus = {
  managedDefaultAvailable: boolean
  permissions: { canManage: boolean }
  connection: null | {
    id: string
    name: string
    host: string
    status: 'pending' | 'connected' | 'error' | 'disconnected'
    detectedVersion: string | null
    eventSubscriptions: string[]
    lastValidatedAt: string | null
    lastEventAt: string | null
    lastError: string | null
    inboundWebhookUrl: string
    credentials: {
      apiKey: boolean
      outboundWebhook: boolean
      signingSecret: boolean
    }
  }
  recentDeliveries: Array<{
    direction: 'inbound' | 'outbound'
    status: string
    event_type: string
    http_status: number | null
    created_at: string
  }>
}

const events = [
  ['contact.created', 'Contato criado'],
  ['contact.updated', 'Contato atualizado'],
  ['message.received', 'Mensagem recebida'],
  ['booking.created', 'Agendamento criado'],
  ['automation.completed', 'Automação concluída'],
  ['automation.node', 'Etapa de automação'],
] as const

type N8nEventSubscription = (typeof events)[number][0]
type N8nConnectionForm = {
  name: string
  baseUrl: string
  apiKey: string
  outboundWebhookUrl: string
  signingSecret: string
  eventSubscriptions: N8nEventSubscription[]
}

export const Route = createFileRoute('/_app/integracoes')({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const [selected, setSelected] = useState<ProviderKey>('n8n')
  const [meta, setMeta] = useState<MetaStatus | null>(null)
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [n8n, setN8n] = useState<N8nStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)
  const [generatedSecret, setGeneratedSecret] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [form, setForm] = useState<N8nConnectionForm>({
    name: 'n8n principal',
    baseUrl: '',
    apiKey: '',
    outboundWebhookUrl: '',
    signingSecret: '',
    eventSubscriptions: events.map(([value]) => value),
  })

  const loadStatus = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled([
      apiFetch<MetaStatus>('/api/integrations/meta/status'),
      apiFetch<GoogleStatus>('/api/integrations/google/status'),
      apiFetch<AiStatus>('/api/ai/settings'),
      apiFetch<N8nStatus>('/api/integrations/n8n/status'),
    ])
    if (results[0].status === 'fulfilled') setMeta(results[0].value)
    if (results[1].status === 'fulfilled') setGoogle(results[1].value)
    if (results[2].status === 'fulfilled') setAi(results[2].value)
    const n8nResult = results[3]
    if (n8nResult.status === 'fulfilled') {
      setN8n(n8nResult.value)
      if (n8nResult.value.connection)
        setForm((current) => ({
          ...current,
          name: n8nResult.value.connection?.name ?? current.name,
          eventSubscriptions:
            n8nResult.value.connection?.eventSubscriptions.filter(
              (value): value is N8nEventSubscription =>
                events.some(([event]) => event === value),
            ) ?? current.eventSubscriptions,
        }))
    }
    if (results.every((result) => result.status === 'rejected'))
      setFeedback({
        tone: 'error',
        text: 'Entre com uma conta real para consultar e configurar integrações.',
      })
    setLoading(false)
  }, [])

  useEffect(() => void loadStatus(), [loadStatus])

  const providerCards = useMemo(
    () => [
      {
        key: 'instagram' as const,
        label: 'Instagram',
        description: 'DMs, comentários, stories e publicação',
        icon: Instagram,
        ready: Boolean(
          meta?.accounts.some(
            (account) => account.status === 'connected' && account.tokenStored,
          ),
        ),
      },
      {
        key: 'whatsapp' as const,
        label: 'WhatsApp',
        description: 'Cloud API, templates e atendimento',
        icon: MessageCircle,
        ready: Boolean(
          meta?.whatsapp.accounts.some(
            (account) => account.status === 'connected' && account.tokenStored,
          ),
        ),
      },
      {
        key: 'google' as const,
        label: 'Google Workspace',
        description: 'Calendar, Meet e Tasks',
        icon: CalendarDays,
        ready: Boolean(
          google?.connections.some(
            (connection) =>
              connection.status === 'connected' && connection.tokenStored,
          ),
        ),
      },
      {
        key: 'ai' as const,
        label: 'IA',
        description: 'OpenAI ou Gemini por workspace',
        icon: Bot,
        ready: Boolean(
          ai?.settings.isEnabled &&
          ai.providers[ai.settings.provider].configured,
        ),
      },
      {
        key: 'n8n' as const,
        label: 'n8n',
        description: 'APIs, webhooks e automações externas',
        icon: PlugZap,
        ready: n8n?.connection?.status === 'connected',
      },
    ],
    [ai, google, meta, n8n],
  )
  const readyCount = providerCards.filter((provider) => provider.ready).length

  async function configureN8n() {
    setBusy('configure')
    setFeedback(null)
    setGeneratedSecret('')
    try {
      const result = await apiFetch<{
        connectionId: string
        generatedSigningSecret: string | null
        version: string | null
      }>('/api/integrations/n8n/configure', {
        method: 'PUT',
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl || undefined,
          apiKey: form.apiKey || undefined,
          outboundWebhookUrl: form.outboundWebhookUrl || undefined,
          signingSecret: form.signingSecret || undefined,
          eventSubscriptions: form.eventSubscriptions,
        }),
      })
      setGeneratedSecret(result.generatedSigningSecret ?? '')
      setForm((current) => ({
        ...current,
        apiKey: '',
        signingSecret: '',
      }))
      setFeedback({
        tone: 'success',
        text: `API n8n validada${result.version ? ` na versão ${result.version}` : ''}.`,
      })
      await loadStatus()
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao configurar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function testN8n(mode: 'api' | 'outbound') {
    setBusy(`test-${mode}`)
    setFeedback(null)
    try {
      await apiFetch('/api/integrations/n8n/test', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      })
      setFeedback({
        tone: 'success',
        text:
          mode === 'api'
            ? 'API key e acesso aos workflows validados.'
            : 'Evento assinado entregue ao webhook de produção do n8n.',
      })
      await loadStatus()
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Teste não concluído.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function disconnectN8n() {
    if (!window.confirm('Desconectar o n8n e apagar suas credenciais?')) return
    setBusy('disconnect')
    try {
      await apiFetch('/api/integrations/n8n/disconnect', { method: 'DELETE' })
      setFeedback({ tone: 'success', text: 'Conexão n8n removida.' })
      setGeneratedSecret('')
      await loadStatus()
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao desconectar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function connectGoogle() {
    setBusy('google')
    try {
      const result = await apiFetch<{ authorizationUrl: string }>(
        '/api/integrations/google/start',
        { method: 'POST' },
      )
      window.location.assign(result.authorizationUrl)
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao conectar.',
      })
      setBusy(null)
    }
  }

  function copyValue(value: string, key: string) {
    void navigator.clipboard.writeText(value)
    setCopied(key)
    window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="Conecte. Valide. Coloque pra rodar."
        description="Um único assistente para Meta, Google, IA e automações externas — com credenciais isoladas por workspace."
        actions={
          <button
            className="button button-outline"
            onClick={() => void loadStatus()}
            disabled={loading || Boolean(busy)}
          >
            <RefreshCw className={loading ? 'spin' : ''} size={16} /> Atualizar
          </button>
        }
      />

      {feedback && (
        <div
          className={feedback.tone === 'error' ? 'form-error' : 'form-success'}
          role="status"
        >
          {feedback.tone === 'success' ? (
            <CheckCircle2 size={16} />
          ) : (
            <Webhook size={16} />
          )}
          {feedback.text}
        </div>
      )}

      <section className="card integration-readiness">
        <div>
          <span className="eyebrow">CENTRAL DE CONEXÕES</span>
          <h2>{readyCount} de 5 ferramentas prontas</h2>
          <p>
            Cada conector precisa concluir credencial, permissão, webhook e
            teste antes de ser usado em automações.
          </p>
        </div>
        <div className="integration-progress" aria-label={`${readyCount} de 5`}>
          <span style={{ width: `${(readyCount / 5) * 100}%` }} />
        </div>
      </section>

      <div className="integration-provider-grid">
        {providerCards.map((provider) => {
          const Icon = provider.icon
          return (
            <button
              key={provider.key}
              className={`card integration-provider ${selected === provider.key ? 'selected' : ''}`}
              onClick={() => setSelected(provider.key)}
              aria-pressed={selected === provider.key}
            >
              <span className="integration-provider-icon">
                <Icon size={21} />
              </span>
              <span>
                <strong>{provider.label}</strong>
                <small>{provider.description}</small>
              </span>
              <StatusDot tone={provider.ready ? 'green' : 'orange'}>
                {provider.ready ? 'Pronto' : 'Pendente'}
              </StatusDot>
            </button>
          )
        })}
      </div>

      {selected === 'n8n' ? (
        <N8nWizard
          status={n8n}
          form={form}
          setForm={setForm}
          busy={busy}
          generatedSecret={generatedSecret}
          copied={copied}
          onCopy={copyValue}
          onConfigure={configureN8n}
          onTest={testN8n}
          onDisconnect={disconnectN8n}
        />
      ) : (
        <ProviderConnectionPanel
          provider={selected}
          ready={
            providerCards.find((item) => item.key === selected)?.ready ?? false
          }
          platformConfigured={
            selected === 'google'
              ? Boolean(google?.platformConfigured)
              : selected === 'whatsapp'
                ? Boolean(meta?.whatsapp.embeddedSignupConfigured)
                : selected === 'instagram'
                  ? Boolean(meta?.platformConfigured)
                  : true
          }
          busy={busy}
          onGoogle={connectGoogle}
        />
      )}
    </div>
  )
}

function N8nWizard({
  status,
  form,
  setForm,
  busy,
  generatedSecret,
  copied,
  onCopy,
  onConfigure,
  onTest,
  onDisconnect,
}: {
  status: N8nStatus | null
  form: N8nConnectionForm
  setForm: React.Dispatch<React.SetStateAction<typeof form>>
  busy: string | null
  generatedSecret: string
  copied: string | null
  onCopy: (value: string, key: string) => void
  onConfigure: () => Promise<void>
  onTest: (mode: 'api' | 'outbound') => Promise<void>
  onDisconnect: () => Promise<void>
}) {
  const connection = status?.connection
  const checks = [
    Boolean(connection),
    Boolean(connection?.credentials.apiKey),
    Boolean(connection?.credentials.signingSecret),
    connection?.status === 'connected',
  ]
  return (
    <section className="card connection-wizard" aria-labelledby="n8n-title">
      <div className="connection-wizard-head">
        <div>
          <span className="eyebrow">N8N · CONECTOR BIDIRECIONAL</span>
          <h2 id="n8n-title">API, eventos e webhooks assinados</h2>
          <p>
            O Wal Chat envia eventos ao workflow e recebe ações controladas de
            CRM, tags e execução de automações.
          </p>
        </div>
        <StatusDot
          tone={connection?.status === 'connected' ? 'green' : 'orange'}
        >
          {connection?.status === 'connected'
            ? 'Conectado'
            : 'Configuração pendente'}
        </StatusDot>
      </div>

      <ol className="connection-stepper" aria-label="Progresso da conexão n8n">
        {['Instância', 'API key', 'Assinatura HMAC', 'Teste real'].map(
          (label, index) => (
            <li className={checks[index] ? 'ready' : ''} key={label}>
              <span>{checks[index] ? <Check size={15} /> : index + 1}</span>
              <strong>{label}</strong>
            </li>
          ),
        )}
      </ol>

      {connection && (
        <div className="connection-summary">
          <div>
            <small>Instância</small>
            <strong>{connection.host}</strong>
          </div>
          <div>
            <small>Versão detectada</small>
            <strong>
              {connection.detectedVersion ?? 'Header não informado'}
            </strong>
          </div>
          <div>
            <small>Última validação</small>
            <strong>
              {connection.lastValidatedAt
                ? new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(connection.lastValidatedAt))
                : 'Ainda não validado'}
            </strong>
          </div>
        </div>
      )}

      <div className="connection-wizard-grid">
        <div className="connection-form">
          <label htmlFor="n8n-name">Nome da conexão</label>
          <input
            id="n8n-name"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
          />
          <label htmlFor="n8n-base-url">URL base da instância</label>
          <input
            id="n8n-base-url"
            type="url"
            placeholder={
              connection
                ? `https://${connection.host}`
                : 'https://n8n.seu-dominio.com'
            }
            value={form.baseUrl}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                baseUrl: event.target.value,
              }))
            }
          />
          <small>
            Em produção, somente HTTPS e destinos públicos são aceitos.
          </small>

          <label htmlFor="n8n-api-key">API key</label>
          <input
            id="n8n-api-key"
            type="password"
            autoComplete="new-password"
            placeholder={
              connection?.credentials.apiKey
                ? 'Salva — deixe vazio para manter'
                : 'X-N8N-API-KEY'
            }
            value={form.apiKey}
            onChange={(event) =>
              setForm((current) => ({ ...current, apiKey: event.target.value }))
            }
          />

          <label htmlFor="n8n-outbound">Webhook de produção do n8n</label>
          <input
            id="n8n-outbound"
            type="url"
            placeholder={
              connection?.credentials.outboundWebhook
                ? 'Salvo — informe apenas para substituir'
                : 'https://n8n.../webhook/wal-chat'
            }
            value={form.outboundWebhookUrl}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                outboundWebhookUrl: event.target.value,
              }))
            }
          />

          <label htmlFor="n8n-secret">Segredo HMAC compartilhado</label>
          <input
            id="n8n-secret"
            type="password"
            autoComplete="new-password"
            placeholder={
              connection?.credentials.signingSecret
                ? 'Salvo — deixe vazio para manter'
                : 'Mínimo de 24 caracteres ou gere automaticamente'
            }
            value={form.signingSecret}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                signingSecret: event.target.value,
              }))
            }
          />
        </div>

        <aside className="connection-contract">
          <div className="connection-contract-title">
            <Webhook size={19} />
            <div>
              <strong>Eventos enviados ao n8n</strong>
              <small>Escolha somente o que o workflow realmente usa.</small>
            </div>
          </div>
          {events.map(([value, label]) => (
            <label className="connection-event" key={value}>
              <input
                type="checkbox"
                checked={form.eventSubscriptions.includes(value)}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    eventSubscriptions: event.target.checked
                      ? [...current.eventSubscriptions, value]
                      : current.eventSubscriptions.filter(
                          (item) => item !== value,
                        ),
                  }))
                }
              />
              <span>
                <strong>{label}</strong>
                <small>{value}</small>
              </span>
            </label>
          ))}
          <div className="connection-security-note">
            <ShieldCheck size={18} />
            <p>
              Assinatura sobre os bytes exatos, janela anti-replay de 5 minutos
              e delivery ID único.
            </p>
          </div>
        </aside>
      </div>

      {generatedSecret && (
        <div className="one-time-secret" role="status">
          <div>
            <strong>Copie agora: este segredo aparece uma única vez.</strong>
            <code>{generatedSecret}</code>
          </div>
          <button
            className="button button-outline"
            onClick={() => onCopy(generatedSecret, 'secret')}
          >
            {copied === 'secret' ? <Check size={15} /> : <Copy size={15} />}
            {copied === 'secret' ? 'Copiado' : 'Copiar segredo'}
          </button>
        </div>
      )}

      {connection?.inboundWebhookUrl && (
        <div className="copy-field connection-webhook-url">
          <input
            value={connection.inboundWebhookUrl}
            readOnly
            aria-label="Webhook de entrada do Wal Chat"
          />
          <button
            onClick={() => onCopy(connection.inboundWebhookUrl, 'webhook')}
          >
            {copied === 'webhook' ? <Check size={15} /> : <Copy size={15} />}
            {copied === 'webhook' ? 'Copiado' : 'Copiar webhook'}
          </button>
        </div>
      )}

      <div className="connection-actions">
        <button
          className="button button-orange"
          onClick={() => void onConfigure()}
          disabled={
            !status?.permissions.canManage ||
            (!form.baseUrl && !connection && !status.managedDefaultAvailable) ||
            Boolean(busy)
          }
        >
          {busy === 'configure' ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <PlugZap size={16} />
          )}
          Salvar e validar API
        </button>
        {connection && (
          <>
            <button
              className="button button-outline"
              onClick={() => void onTest('api')}
              disabled={Boolean(busy)}
            >
              <RefreshCw size={15} /> Testar API
            </button>
            <button
              className="button button-dark"
              onClick={() => void onTest('outbound')}
              disabled={
                !connection.credentials.outboundWebhook || Boolean(busy)
              }
            >
              <Send size={15} /> Testar webhook
            </button>
            <button
              className="button button-danger-quiet"
              onClick={() => void onDisconnect()}
              disabled={Boolean(busy)}
            >
              <Unplug size={15} /> Desconectar
            </button>
          </>
        )}
      </div>
    </section>
  )
}

function ProviderConnectionPanel({
  provider,
  ready,
  platformConfigured,
  busy,
  onGoogle,
}: {
  provider: Exclude<ProviderKey, 'n8n'>
  ready: boolean
  platformConfigured: boolean
  busy: string | null
  onGoogle: () => Promise<void>
}) {
  const labels = {
    instagram: [
      'Instagram profissional',
      'OAuth, permissões e webhooks da Meta',
    ],
    whatsapp: [
      'WhatsApp Business',
      'Embedded Signup, WABA e templates oficiais',
    ],
    google: ['Google Workspace', 'Calendar, Meet e Tasks com OAuth e PKCE'],
    ai: ['Agentes de IA', 'OpenAI ou Gemini com chave isolada por workspace'],
  } as const
  return (
    <section className="card provider-connection-panel">
      <div>
        <span className="eyebrow">ASSISTENTE DE CONEXÃO</span>
        <h2>{labels[provider][0]}</h2>
        <p>{labels[provider][1]}</p>
      </div>
      <div className="provider-checklist">
        <div className={platformConfigured ? 'ready' : ''}>
          <span>{platformConfigured ? <Check size={15} /> : '1'}</span>
          <strong>Backend e credenciais da aplicação</strong>
        </div>
        <div className={ready ? 'ready' : ''}>
          <span>{ready ? <Check size={15} /> : '2'}</span>
          <strong>Conta, token e permissões validados</strong>
        </div>
        <div className={ready ? 'ready' : ''}>
          <span>{ready ? <Check size={15} /> : '3'}</span>
          <strong>Pronto para o gate de produção</strong>
        </div>
      </div>
      <div className="connection-actions">
        {provider === 'google' ? (
          <button
            className="button button-orange"
            onClick={() => void onGoogle()}
            disabled={!platformConfigured || ready || Boolean(busy)}
          >
            <ExternalLink size={15} /> Conectar Google
          </button>
        ) : (
          <Link className="button button-orange" to="/configuracoes">
            Abrir configuração guiada <ExternalLink size={15} />
          </Link>
        )}
        <Link className="button button-outline" to="/operacoes">
          Ver gates de Go-Live
        </Link>
      </div>
    </section>
  )
}
