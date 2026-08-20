/** Sala de operação: Go-Live, kill switches e telemetria dos webhooks. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Webhook,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageIntro, StatusDot, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/operacoes')({
  component: OperationsPage,
})

type CheckStatus = 'pass' | 'fail' | 'warning'
type GoLiveCheck = {
  id: string
  category: 'infra' | 'meta' | 'compliance' | 'ai' | 'operations'
  label: string
  status: CheckStatus
  detail: string
  actionHref?: string
}
type GoLiveStatus = {
  checks: GoLiveCheck[]
  summary: { passed: number; warnings: number; failed: number; total: number }
  canEnableExternalSends: boolean
  settings: {
    externalSendsEnabled: boolean
    commentToDmEnabled: boolean
    autonomousAiEnabled: boolean
    activatedAt: string | null
  }
  activeAccount: { id: string; username: string } | null
  generatedAt: string
}
type WebhookEvent = {
  id: string
  meta_event_key: string
  instagram_user_id: string | null
  event_type: string | null
  status: 'queued' | 'processing' | 'processed' | 'failed' | 'ignored'
  attempts: number
  last_error: string | null
  received_at: string
  processed_at: string | null
  duration_ms: number | null
  replayed_at: string | null
}
type WebhookStatus = {
  events: WebhookEvent[]
  summary: Record<WebhookEvent['status'], number>
}

const categoryLabels: Record<GoLiveCheck['category'], string> = {
  infra: 'Infraestrutura',
  meta: 'Meta',
  compliance: 'Segurança',
  ai: 'Inteligência artificial',
  operations: 'Operação',
}

function OperationsPage() {
  const [goLive, setGoLive] = useState<GoLiveStatus | null>(null)
  const [webhooks, setWebhooks] = useState<WebhookStatus | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<{
    tone: 'error' | 'success'
    text: string
  } | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy('load')
    try {
      const [status, events] = await Promise.all([
        apiFetch<GoLiveStatus>('/api/operations/go-live'),
        apiFetch<WebhookStatus>('/api/operations/webhooks'),
      ])
      setGoLive(status)
      setWebhooks(events)
      if (!silent) setFeedback(null)
    } catch (error) {
      setFeedback({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Falha ao carregar a operação.',
      })
    } finally {
      if (!silent) setBusy(null)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(interval)
  }, [load])

  const groupedChecks = useMemo(() => {
    const groups = new Map<GoLiveCheck['category'], GoLiveCheck[]>()
    for (const item of goLive?.checks ?? [])
      groups.set(item.category, [...(groups.get(item.category) ?? []), item])
    return Array.from(groups.entries())
  }, [goLive])

  async function updateControls(
    changes: Partial<GoLiveStatus['settings']> & { confirmation?: string },
    operation: string,
  ) {
    setBusy(operation)
    setFeedback(null)
    try {
      const updated = await apiFetch<GoLiveStatus>('/api/operations/go-live', {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      setGoLive(updated)
      setConfirmation('')
      setFeedback({ tone: 'success', text: 'Controles atualizados.' })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao atualizar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function replay(eventId: string) {
    setBusy(`replay-${eventId}`)
    try {
      await apiFetch('/api/operations/webhooks', {
        method: 'POST',
        body: JSON.stringify({ eventId }),
      })
      setFeedback({ tone: 'success', text: 'Webhook reenfileirado.' })
      await load(true)
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha no replay.',
      })
    } finally {
      setBusy(null)
    }
  }

  const enabled = goLive?.settings.externalSendsEnabled ?? false
  return (
    <div className="stack-lg">
      <PageIntro
        title="Produção sob controle."
        description="Diagnóstico verificável, ativação por workspace e rastreio de cada webhook da Meta."
        actions={
          <button
            className="button button-outline"
            onClick={() => void load()}
            disabled={Boolean(busy)}
          >
            <RefreshCw size={16} className={busy === 'load' ? 'spin' : ''} />
            Atualizar diagnóstico
          </button>
        }
      />

      {feedback && (
        <div
          className={feedback.tone === 'error' ? 'form-error' : 'form-success'}
          role="status"
        >
          {feedback.tone === 'error' ? (
            <AlertTriangle size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          {feedback.text}
        </div>
      )}

      <section className={`go-live-hero ${enabled ? 'enabled' : ''}`}>
        <div className="go-live-score">
          <span>
            {goLive ? `${goLive.summary.passed}/${goLive.summary.total}` : '—'}
          </span>
          <small>checagens aprovadas</small>
        </div>
        <div className="go-live-copy">
          <span className="eyebrow">CENTRAL DE GO-LIVE</span>
          <h2>
            {enabled ? 'Disparos externos liberados' : 'Disparos bloqueados'}
          </h2>
          <p>
            {enabled
              ? `Workspace ativo${goLive?.activeAccount ? ` com @${goLive.activeAccount.username}` : ''}. O gateway ainda reaplica compliance em cada envio.`
              : 'Nada sai para a Meta até todas as verificações críticas passarem e um administrador confirmar a ativação.'}
          </p>
        </div>
        <div className="go-live-action">
          {!enabled ? (
            <>
              <label htmlFor="production-confirmation">
                Digite <strong>ATIVAR PRODUCAO</strong>
              </label>
              <input
                id="production-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="ATIVAR PRODUCAO"
                autoComplete="off"
              />
              <button
                className="button button-dark"
                onClick={() =>
                  void updateControls(
                    {
                      externalSendsEnabled: true,
                      confirmation,
                    },
                    'activate',
                  )
                }
                disabled={
                  !goLive?.canEnableExternalSends ||
                  confirmation !== 'ATIVAR PRODUCAO' ||
                  Boolean(busy)
                }
              >
                <Power size={16} /> Ativar produção
              </button>
            </>
          ) : (
            <button
              className="button button-danger-outline"
              onClick={() =>
                void updateControls(
                  { externalSendsEnabled: false },
                  'deactivate',
                )
              }
              disabled={Boolean(busy)}
            >
              <Power size={16} /> Bloquear disparos
            </button>
          )}
        </div>
      </section>

      <div className="operations-grid">
        <section className="card readiness-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">CHECKLIST EXECUTÁVEL</span>
              <h3>Prontidão da operação</h3>
            </div>
            <StatusDot
              tone={
                goLive?.summary.failed
                  ? 'red'
                  : goLive?.summary.warnings
                    ? 'orange'
                    : 'green'
              }
            >
              {goLive?.summary.failed
                ? `${goLive.summary.failed} bloqueios`
                : 'Pronto'}
            </StatusDot>
          </div>
          <div className="readiness-groups">
            {groupedChecks.map(([category, items]) => (
              <div className="readiness-group" key={category}>
                <h4>{categoryLabels[category]}</h4>
                {items.map((item) => {
                  const Icon =
                    item.status === 'pass'
                      ? CheckCircle2
                      : item.status === 'warning'
                        ? AlertTriangle
                        : XCircle
                  return (
                    <div
                      className={`readiness-row ${item.status}`}
                      key={item.id}
                    >
                      <Icon size={18} />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                      {item.actionHref && (
                        <a href={item.actionHref}>Resolver</a>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </section>

        <aside className="stack-md">
          <article className="card runtime-controls">
            <div className="card-head">
              <div>
                <span className="eyebrow">KILL SWITCHES</span>
                <h3>Recursos externos</h3>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="runtime-control-row">
              <span>
                <strong>Comment-to-DM</strong>
                <small>Private Reply única por comentário</small>
              </span>
              <Switch
                checked={goLive?.settings.commentToDmEnabled ?? false}
                label="Ativar Comment-to-DM"
                disabled={!enabled || Boolean(busy)}
                onChange={() =>
                  void updateControls(
                    {
                      commentToDmEnabled: !goLive?.settings.commentToDmEnabled,
                    },
                    'comment-to-dm',
                  )
                }
              />
            </div>
            <div className="runtime-control-row">
              <span>
                <strong>Agente autônomo</strong>
                <small>Copiloto continua disponível sem esta opção</small>
              </span>
              <Switch
                checked={goLive?.settings.autonomousAiEnabled ?? false}
                label="Ativar agentes autônomos"
                disabled={!enabled || Boolean(busy)}
                onChange={() =>
                  void updateControls(
                    {
                      autonomousAiEnabled:
                        !goLive?.settings.autonomousAiEnabled,
                    },
                    'autonomous-ai',
                  )
                }
              />
            </div>
          </article>
          <article className="card operation-note">
            <Activity size={21} />
            <div>
              <strong>Atualização automática</strong>
              <p>Diagnóstico e eventos são renovados a cada 15 segundos.</p>
              <small>
                Última leitura:{' '}
                {goLive
                  ? new Date(goLive.generatedAt).toLocaleTimeString('pt-BR')
                  : 'carregando'}
              </small>
            </div>
          </article>
        </aside>
      </div>

      <section className="card webhook-observability">
        <div className="card-head">
          <div>
            <span className="eyebrow">OBSERVABILIDADE</span>
            <h3>Eventos do Instagram</h3>
          </div>
          <Webhook size={21} />
        </div>
        <div className="webhook-summary">
          {(['processed', 'queued', 'processing', 'failed'] as const).map(
            (status) => (
              <span key={status} className={status}>
                <strong>{webhooks?.summary[status] ?? 0}</strong>
                {status === 'processed'
                  ? 'Processados'
                  : status === 'queued'
                    ? 'Na fila'
                    : status === 'processing'
                      ? 'Processando'
                      : 'Falharam'}
              </span>
            ),
          )}
        </div>
        <div className="webhook-table-wrap">
          <table className="webhook-table">
            <thead>
              <tr>
                <th>Recebido</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Tentativas</th>
                <th>Tempo</th>
                <th>Diagnóstico</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {(webhooks?.events ?? []).map((event) => (
                <tr key={event.id}>
                  <td>
                    <Clock3 size={14} />{' '}
                    {new Date(event.received_at).toLocaleString('pt-BR')}
                  </td>
                  <td>{event.event_type ?? 'não classificado'}</td>
                  <td>
                    <span className={`event-status ${event.status}`}>
                      {event.status}
                    </span>
                  </td>
                  <td>{event.attempts}</td>
                  <td>{event.duration_ms ? `${event.duration_ms} ms` : '—'}</td>
                  <td>{event.last_error ?? 'Sem erro'}</td>
                  <td>
                    {event.status === 'failed' ? (
                      <button
                        className="button button-outline button-compact"
                        onClick={() => void replay(event.id)}
                        disabled={busy === `replay-${event.id}`}
                      >
                        {busy === `replay-${event.id}` ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : (
                          <RotateCcw size={14} />
                        )}
                        Replay
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {webhooks && webhooks.events.length === 0 && (
                <tr>
                  <td colSpan={7} className="table-empty">
                    Nenhum evento recebido para este workspace.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
