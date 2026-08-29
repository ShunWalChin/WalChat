/** Trilha de auditoria unificada para operações e integrações. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ClipboardList,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { PageIntro, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import './deskcomm.css'

type AuditData = {
  events: Array<{
    id: string
    source: 'operation' | 'integration'
    actorName: string
    action: string
    resourceType: string
    resourceId: string | null
    status: string
    details: unknown
    createdAt: string
  }>
}

export const Route = createFileRoute('/_app/auditoria')({
  component: AuditPage,
})

function AuditPage() {
  const [data, setData] = useState<AuditData | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(100)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (action = query, nextLimit = limit) => {
      setLoading(true)
      try {
        setData(
          await apiFetch<AuditData>(
            `/api/audit?limit=${nextLimit}&action=${encodeURIComponent(action.trim())}`,
          ),
        )
        setError(null)
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Falha ao carregar.',
        )
      } finally {
        setLoading(false)
      }
    },
    [limit, query],
  )

  useEffect(() => {
    void load('', 100)
  }, []) // Consulta inicial deliberadamente sem filtros.
  function search(event: FormEvent) {
    event.preventDefault()
    void load()
  }

  return (
    <div className="stack-lg deskcomm-page">
      <PageIntro
        title="Cada alteração deixa rastro."
        description="Consulte ações de usuários, automações e integrações com data, recurso, resultado e contexto operacional."
        actions={
          <button
            className="button button-outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'spin' : ''} size={16} /> Atualizar
          </button>
        }
      />
      <section className="card deskcomm-toolbar">
        <form className="audit-search" onSubmit={search}>
          <label className="search-field deskcomm-search">
            <span className="sr-only">Filtrar por ação</span>
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filtrar por ação…"
            />
          </label>
          <select
            aria-label="Quantidade de eventos"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            <option value="50">50 eventos</option>
            <option value="100">100 eventos</option>
            <option value="200">200 eventos</option>
          </select>
          <button className="button button-dark">
            <Search size={15} /> Buscar
          </button>
        </form>
      </section>
      {error && (
        <div className="form-error" role="status">
          {error}
        </div>
      )}
      {loading && !data ? (
        <div className="card deskcomm-loading">
          <LoaderCircle className="spin" /> Carregando auditoria…
        </div>
      ) : (
        <section className="card audit-card">
          <header className="deskcomm-section-header">
            <div>
              <strong>Eventos</strong>
              <span>{data?.events.length ?? 0} registro(s) mais recentes</span>
            </div>
            <ClipboardList size={19} />
          </header>
          <div className="audit-list">
            {data?.events.map((event) => (
              <article key={`${event.source}-${event.id}`}>
                <span className={`audit-icon ${event.source}`}>
                  <ShieldCheck size={17} />
                </span>
                <div className="audit-main">
                  <div>
                    <strong>{actionLabel(event.action)}</strong>
                    <StatusDot
                      tone={
                        event.status === 'success' ||
                        event.status === 'completed'
                          ? 'green'
                          : 'orange'
                      }
                    >
                      {event.status}
                    </StatusDot>
                  </div>
                  <p>
                    {event.actorName} · {event.resourceType}
                    {event.resourceId
                      ? ` · ${event.resourceId.slice(0, 8)}`
                      : ''}
                  </p>
                  <small>
                    {new Date(event.createdAt).toLocaleString('pt-BR')} ·{' '}
                    {event.source === 'operation' ? 'Operação' : 'Integração'}
                  </small>
                  {event.details != null && (
                    <details>
                      <summary>Ver detalhes</summary>
                      <pre>{formatDetails(event.details)}</pre>
                    </details>
                  )}
                </div>
              </article>
            ))}
            {!data?.events.length && (
              <p className="compact-empty">
                Nenhum evento encontrado para este filtro.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function actionLabel(action: string) {
  return action
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase())
}
function formatDetails(details: unknown) {
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}
