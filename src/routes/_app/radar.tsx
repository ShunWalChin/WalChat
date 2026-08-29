/** Radar comercial: oportunidades sem próximo passo ou esfriando. */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertOctagon,
  CalendarClock,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Plane,
  RefreshCw,
  ThermometerSun,
  X,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { PageIntro, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import './deskcomm.css'

type RadarLead = {
  id: string
  title: string
  pipelineName: string
  stageName: string
  stageColor: string
  valueCents: number | null
  lastActivityAt: string | null
  nextActionAt: string | null
  expectedCloseDate: string | null
  lockVersion: number
  needsAction: boolean
  risk: {
    bucket: 'em_dia' | 'em_voo' | 'em_risco' | 'critico'
    elapsedHours: number
    ratio: number
  }
  contact: {
    display_name: string | null
    full_name: string | null
    username: string | null
    phone: string | null
  } | null
}
type RadarData = {
  leads: RadarLead[]
  summary: {
    critical: number
    atRisk: number
    inFlight: number
    onTrack: number
    needsAction: number
  }
}

export const Route = createFileRoute('/_app/radar')({ component: RadarPage })

function RadarPage() {
  const [data, setData] = useState<RadarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeLead, setActiveLead] = useState<RadarLead | null>(null)
  const [nextActionAt, setNextActionAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await apiFetch<RadarData>('/api/crm/radar'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => void load(), [load])

  async function schedule(event: FormEvent) {
    event.preventDefault()
    if (!activeLead || !nextActionAt) return
    try {
      await apiFetch(`/api/crm/${activeLead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          kind: 'update',
          expectedLockVersion: activeLead.lockVersion,
          nextActionAt: new Date(nextActionAt).toISOString(),
        }),
      })
      setFeedback(`Próximo passo agendado para ${activeLead.title}.`)
      setActiveLead(null)
      setNextActionAt('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao agendar.')
    }
  }

  return (
    <div className="stack-lg deskcomm-page">
      <PageIntro
        title="O que está esfriando aparece antes de morrer."
        description="O Radar compara o tempo sem atividade com a janela de cada etapa e destaca leads sem próximo passo."
        actions={
          <>
            <button
              className="button button-outline"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={loading ? 'spin' : ''} size={16} />{' '}
              Atualizar
            </button>
            <Link to="/crm" className="button button-dark">
              Abrir pipeline
            </Link>
          </>
        }
      />

      <div className="mini-stats deskcomm-stats">
        <RadarStat
          icon={<AlertOctagon />}
          value={data?.summary.critical ?? 0}
          label="críticos"
        />
        <RadarStat
          icon={<ThermometerSun />}
          value={data?.summary.atRisk ?? 0}
          label="em risco"
        />
        <RadarStat
          icon={<Plane />}
          value={data?.summary.inFlight ?? 0}
          label="em voo"
        />
        <RadarStat
          icon={<CalendarClock />}
          value={data?.summary.needsAction ?? 0}
          label="sem próximo passo"
        />
      </div>

      {(feedback || error) && (
        <div className={error ? 'form-error' : 'form-success'} role="status">
          {error ?? feedback}
          <button
            className="icon-button compact"
            aria-label="Fechar aviso"
            onClick={() => {
              setError(null)
              setFeedback(null)
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <section className="card radar-list">
        <header className="deskcomm-section-header">
          <div>
            <strong>Prioridade de hoje</strong>
            <span>
              Críticos primeiro; dentro da faixa, maior silêncio primeiro.
            </span>
          </div>
        </header>
        {loading && !data ? (
          <div className="deskcomm-loading">
            <LoaderCircle className="spin" /> Carregando Radar…
          </div>
        ) : data?.leads.length ? (
          data.leads.map((lead) => (
            <article className="radar-row" key={lead.id}>
              <span
                className="radar-stage-mark"
                style={{ background: lead.stageColor }}
              />
              <div className="radar-main">
                <div>
                  <strong>{lead.title}</strong>
                  <StatusDot tone={riskTone(lead.risk.bucket)}>
                    {riskLabel(lead.risk.bucket)}
                  </StatusDot>
                </div>
                <p>
                  {lead.pipelineName} · {lead.stageName} · {contactName(lead)}
                </p>
              </div>
              <div className="radar-metrics">
                <span>
                  <Clock3 size={14} /> {Math.round(lead.risk.elapsedHours)}h sem
                  atividade
                </span>
                <span>
                  {lead.valueCents === null
                    ? 'Sem valor'
                    : money(lead.valueCents)}
                </span>
              </div>
              <button
                className="button button-outline"
                onClick={() => setActiveLead(lead)}
              >
                <CalendarClock size={15} /> Próximo passo
              </button>
            </article>
          ))
        ) : (
          <div className="deskcomm-empty">
            <CheckCircle2 size={28} />
            <strong>Nenhum lead aberto no Radar.</strong>
            <p>
              Quando houver oportunidades, o risco será calculado
              automaticamente.
            </p>
          </div>
        )}
      </section>

      {activeLead && (
        <div className="deskcomm-modal-backdrop" role="presentation">
          <section
            className="deskcomm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="radar-dialog-title"
          >
            <header>
              <h3 id="radar-dialog-title">Agendar próximo passo</h3>
              <button
                className="icon-button"
                aria-label="Fechar"
                onClick={() => setActiveLead(null)}
              >
                <X size={18} />
              </button>
            </header>
            <form className="deskcomm-form" onSubmit={schedule}>
              <p>
                Defina quando <strong>{activeLead.title}</strong> deve voltar
                para sua atenção.
              </p>
              <label>
                Data e hora
                <input
                  type="datetime-local"
                  value={nextActionAt}
                  onChange={(event) => setNextActionAt(event.target.value)}
                  required
                  autoFocus
                />
              </label>
              <div className="deskcomm-dialog-actions">
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setActiveLead(null)}
                >
                  Cancelar
                </button>
                <button className="button button-dark" disabled={!nextActionAt}>
                  Salvar próximo passo
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

function RadarStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode
  value: number
  label: string
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

function riskTone(bucket: RadarLead['risk']['bucket']) {
  if (bucket === 'critico') return 'red' as const
  if (bucket === 'em_risco') return 'orange' as const
  if (bucket === 'em_voo') return 'blue' as const
  return 'green' as const
}

function riskLabel(bucket: RadarLead['risk']['bucket']) {
  return {
    critico: 'Crítico',
    em_risco: 'Em risco',
    em_voo: 'Em voo',
    em_dia: 'Em dia',
  }[bucket]
}

function contactName(lead: RadarLead) {
  return (
    lead.contact?.display_name ??
    lead.contact?.full_name ??
    (lead.contact?.username ? `@${lead.contact.username}` : null) ??
    lead.contact?.phone ??
    'Sem contato'
  )
}

function money(valueCents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(valueCents / 100)
}
