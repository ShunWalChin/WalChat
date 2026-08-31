/** Administração de endpoints externos para captação segura de leads. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Check,
  Copy,
  LoaderCircle,
  Plus,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Webhook,
  X,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EstadoVazio, PageIntro, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import './deskcomm.css'

type WebhooksData = {
  sources: Array<{
    id: string
    name: string
    pipeline_id: string
    stage_id: string
    is_active: boolean
    last_received_at: string | null
    created_at: string
    endpoint: string
    received: number
  }>
  captures: Array<{
    id: string
    source_id: string
    lead_id: string | null
    status: string
    error_code: string | null
    received_at: string
  }>
  pipelines: Array<{ id: string; name: string }>
  stages: Array<{
    id: string
    pipeline_id: string
    name: string
    terminal_state: string
  }>
  permissions: { canManage: boolean }
}

export const Route = createFileRoute('/_app/webhooks')({
  component: WebhooksPage,
})

function WebhooksPage() {
  const [data, setData] = useState<WebhooksData | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newEndpoint, setNewEndpoint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await apiFetch<WebhooksData>('/api/webhook-sources'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => void load(), [load])

  async function copyEndpoint(endpoint: string) {
    await navigator.clipboard.writeText(endpoint)
    setCopied(true)
  }

  const processed =
    data?.captures.filter((item) => item.status === 'processed').length ?? 0
  const failed =
    data?.captures.filter((item) => item.status === 'failed').length ?? 0

  return (
    <div className="stack-lg deskcomm-page">
      <PageIntro
        title="Transforme qualquer formulário em oportunidade."
        description="Crie endpoints isolados por fonte para captar leads externos diretamente no pipeline, sem expor credenciais do workspace."
        actions={
          <div className="button-row">
            <button
              className="button button-outline"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={loading ? 'spin' : ''} size={16} />{' '}
              Atualizar
            </button>
            {data?.permissions.canManage && (
              <button
                className="button button-dark"
                onClick={() => setCreating(true)}
              >
                <Plus size={16} /> Nova fonte
              </button>
            )}
          </div>
        }
      />
      <div className="mini-stats deskcomm-stats">
        <WebhookStat
          value={data?.sources.length ?? 0}
          label="fontes"
          icon={<Webhook />}
        />
        <WebhookStat
          value={data?.captures.length ?? 0}
          label="requisições"
          icon={<RadioTower />}
        />
        <WebhookStat
          value={processed}
          label="leads processados"
          icon={<Check />}
        />
        <WebhookStat value={failed} label="falhas" icon={<ShieldCheck />} />
      </div>
      {error && (
        <div className="form-error" role="status">
          {error}
          <button
            className="icon-button compact"
            onClick={() => setError(null)}
            aria-label="Fechar erro"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {newEndpoint && (
        <section className="card endpoint-reveal" role="status">
          <ShieldCheck size={22} />
          <div>
            <strong>Endpoint criado — copie agora</strong>
            <p>Por segurança, o token não será exibido novamente.</p>
            <code>{newEndpoint}</code>
          </div>
          <button
            className="button button-dark"
            onClick={() => void copyEndpoint(newEndpoint)}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button
            className="icon-button"
            aria-label="Fechar endpoint"
            onClick={() => setNewEndpoint(null)}
          >
            <X size={17} />
          </button>
        </section>
      )}
      {loading && !data ? (
        <div className="card deskcomm-loading">
          <LoaderCircle className="spin" /> Carregando webhooks…
        </div>
      ) : data ? (
        <div className="deskcomm-two-columns webhook-columns">
          <section className="card webhook-source-card">
            <header className="deskcomm-section-header">
              <div>
                <strong>Fontes de captação</strong>
                <span>Endpoints com tokens armazenados somente como hash</span>
              </div>
              <Webhook size={19} />
            </header>
            <div className="webhook-source-list">
              {data.sources.map((source) => (
                <article key={source.id}>
                  <span className="integration-icon">
                    <Webhook size={18} />
                  </span>
                  <div>
                    <strong>{source.name}</strong>
                    <p>
                      {pipelineName(data, source.pipeline_id)} ·{' '}
                      {stageName(data, source.stage_id)}
                    </p>
                    <small>
                      {source.last_received_at
                        ? `Último evento ${new Date(source.last_received_at).toLocaleString('pt-BR')}`
                        : 'Aguardando primeiro evento'}
                    </small>
                  </div>
                  <StatusDot tone={source.is_active ? 'green' : 'gray'}>
                    {source.is_active ? 'Ativo' : 'Pausado'}
                  </StatusDot>
                  <strong>{source.received}</strong>
                </article>
              ))}
              {!data.sources.length && (
                <EstadoVazio
                  titulo="Nenhuma fonte configurada."
                  texto="Cada fonte vira um endereço próprio que recebe formulários de fora e cria o lead direto no pipeline."
                  acao={
                    data.permissions.canManage ? (
                      <button
                        className="button button-orange"
                        onClick={() => setCreating(true)}
                      >
                        <Plus size={16} /> Criar a primeira fonte
                      </button>
                    ) : undefined
                  }
                />
              )}
            </div>
          </section>
          <section className="card webhook-captures-card">
            <header className="deskcomm-section-header">
              <div>
                <strong>Recebimentos recentes</strong>
                <span>Últimas 100 tentativas</span>
              </div>
              <RadioTower size={19} />
            </header>
            <div className="webhook-capture-list">
              {data.captures.slice(0, 20).map((capture) => (
                <article key={capture.id}>
                  <StatusDot
                    tone={
                      capture.status === 'processed'
                        ? 'green'
                        : capture.status === 'failed'
                          ? 'orange'
                          : 'gray'
                    }
                  >
                    {capture.status}
                  </StatusDot>
                  <div>
                    <strong>{sourceName(data, capture.source_id)}</strong>
                    <small>
                      {new Date(capture.received_at).toLocaleString('pt-BR')}
                      {capture.error_code ? ` · ${capture.error_code}` : ''}
                    </small>
                  </div>
                </article>
              ))}
              {!data.captures.length && (
                <p className="compact-empty">Nenhum evento recebido.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {creating && data && (
        <WebhookDialog
          data={data}
          onClose={() => setCreating(false)}
          onCreated={async (endpoint) => {
            setCreating(false)
            setNewEndpoint(endpoint)
            setCopied(false)
            await load()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

function WebhookDialog({
  data,
  onClose,
  onCreated,
  onError,
}: {
  data: WebhooksData
  onClose: () => void
  onCreated: (endpoint: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [pipelineId, setPipelineId] = useState(data.pipelines[0]?.id ?? '')
  const stages = useMemo(
    () =>
      data.stages.filter(
        (stage) =>
          stage.pipeline_id === pipelineId && stage.terminal_state === 'open',
      ),
    [data.stages, pipelineId],
  )
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!stages.some((stage) => stage.id === stageId))
      setStageId(stages[0]?.id ?? '')
  }, [stageId, stages])
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await apiFetch<{ endpoint: string }>(
        '/api/webhook-sources',
        {
          method: 'POST',
          body: JSON.stringify({ name, pipelineId, stageId, fieldMapping: {} }),
        },
      )
      await onCreated(result.endpoint)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Falha ao criar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="deskcomm-modal-backdrop" role="presentation">
      <section
        className="deskcomm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webhook-dialog-title"
      >
        <header>
          <h3 id="webhook-dialog-title">Nova fonte de webhook</h3>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <form className="deskcomm-form" onSubmit={submit}>
          <label>
            Nome da fonte
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Landing page de consultoria"
              required
              autoFocus
            />
          </label>
          <label>
            Pipeline
            <select
              value={pipelineId}
              onChange={(event) => setPipelineId(event.target.value)}
              required
            >
              {data.pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Etapa de entrada
            <select
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
              required
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">
            Envie JSON ou formulário com nome/name, email, phone/telefone,
            title/titulo e value/valor. Campos adicionais ficam disponíveis no
            registro de captura.
          </p>
          <div className="deskcomm-dialog-actions">
            <button
              type="button"
              className="button button-outline"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              className="button button-dark"
              disabled={busy || !name.trim() || !stageId}
            >
              {busy && <LoaderCircle className="spin" size={16} />} Criar
              endpoint
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function WebhookStat({
  value,
  label,
  icon,
}: {
  value: number
  label: string
  icon: ReactNode
}) {
  return (
    <div>
      {icon}
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  )
}
function pipelineName(data: WebhooksData, id: string) {
  return data.pipelines.find((item) => item.id === id)?.name ?? 'Pipeline'
}
function stageName(data: WebhooksData, id: string) {
  return data.stages.find((item) => item.id === id)?.name ?? 'Etapa'
}
function sourceName(data: WebhooksData, id: string) {
  return data.sources.find((item) => item.id === id)?.name ?? 'Fonte removida'
}
