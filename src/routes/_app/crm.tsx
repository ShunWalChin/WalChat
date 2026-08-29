/** Quadro comercial com pipelines, criação e movimento otimista de leads. */
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  GripVertical,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Avatar, PageIntro, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import './deskcomm.css'

type Stage = {
  id: string
  pipeline_id: string
  name: string
  slug: string
  position: number
  color: string
  terminal_state: 'open' | 'won' | 'lost'
  requires_human: boolean
  expected_duration_hours: number
}
type Lead = {
  id: string
  pipelineId: string
  stageId: string
  contactId: string | null
  title: string
  description: string | null
  status: 'open' | 'won' | 'lost'
  position: number
  valueCents: number | null
  currency: string
  ownerUserId: string | null
  ownerName: string | null
  lastActivityAt: string | null
  nextActionAt: string | null
  expectedCloseDate: string | null
  source: string
  tags: string[]
  lockVersion: number
  contact: {
    id: string
    display_name: string | null
    full_name: string | null
    username: string | null
    phone: string | null
    email: string | null
    avatar_url: string | null
    platform: string
  } | null
  score: {
    probability: number | null
    reason: string | null
    band: 'frio' | 'morno' | 'quente' | null
  } | null
  risk: {
    bucket: 'em_dia' | 'em_voo' | 'em_risco' | 'critico'
    since: string
  } | null
}
type CrmData = {
  pipelines: Array<{
    id: string
    name: string
    is_default: boolean
    vocabulary: Record<string, string>
  }>
  activePipelineId: string | null
  stages: Stage[]
  leads: Lead[]
  members: Array<{ id: string; name: string; role: string }>
  permissions: { canWrite: boolean; canManagePipelines: boolean }
  summary: {
    open: number
    won: number
    lost: number
    valueCents: number
    atRisk: number
  }
}
type ContactOption = { id: string; name: string; identity: string }

export const Route = createFileRoute('/_app/crm')({ component: CrmPage })

function CrmPage() {
  const [data, setData] = useState<CrmData | null>(null)
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [pipelineId, setPipelineId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'lead' | 'pipeline' | null>(null)
  const [lostMove, setLostMove] = useState<{
    lead: Lead
    stage: Stage
  } | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (targetPipelineId?: string | null) => {
    setLoading(true)
    try {
      const suffix = targetPipelineId
        ? `?pipelineId=${encodeURIComponent(targetPipelineId)}`
        : ''
      const [crm, contactData] = await Promise.all([
        apiFetch<CrmData>(`/api/crm${suffix}`),
        apiFetch<{ contacts: ContactOption[] }>('/api/contacts?pageSize=100'),
      ])
      setData(crm)
      setPipelineId(crm.activePipelineId)
      setContacts(contactData.contacts)
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao carregar o CRM.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => void load(), [load])

  const visibleLeads = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalized) return data?.leads ?? []
    return (data?.leads ?? []).filter((lead) =>
      [
        lead.title,
        lead.ownerName,
        lead.contact?.display_name,
        lead.contact?.full_name,
        lead.contact?.username,
        ...lead.tags,
      ].some((value) => value?.toLocaleLowerCase('pt-BR').includes(normalized)),
    )
  }, [data?.leads, query])

  async function moveLead(lead: Lead, stage: Stage, lostReason?: string) {
    if (busyLeadId) return
    setBusyLeadId(lead.id)
    try {
      const updated = await apiFetch<{
        stage_id: string
        status: Lead['status']
        lock_version: number
      }>(`/api/crm/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          kind: 'move',
          stageId: stage.id,
          position: Date.now(),
          expectedLockVersion: lead.lockVersion,
          lostReason: lostReason || null,
        }),
      })
      setData((current) =>
        current
          ? {
              ...current,
              leads: current.leads.map((item) =>
                item.id === lead.id
                  ? {
                      ...item,
                      stageId: updated.stage_id,
                      status: updated.status,
                      lockVersion: updated.lock_version,
                      position: Date.now(),
                    }
                  : item,
              ),
            }
          : current,
      )
      setFeedback(`${lead.title} movido para ${stage.name}.`)
      setLostMove(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao mover.')
      await load(pipelineId)
    } finally {
      setBusyLeadId(null)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const lead = data?.leads.find((item) => item.id === String(event.active.id))
    const stage = data?.stages.find(
      (item) => item.id === String(event.over?.id),
    )
    if (!lead || !stage || lead.stageId === stage.id) return
    if (stage.terminal_state === 'lost') setLostMove({ lead, stage })
    else void moveLead(lead, stage)
  }

  return (
    <div className="stack-lg deskcomm-page crm-board-page">
      <PageIntro
        title="Da conversa ao fechamento, sem perder o próximo passo."
        description="Pipeline comercial, responsável, valor, score e risco no mesmo quadro — isolado por workspace."
        actions={
          <>
            {data?.permissions.canManagePipelines && (
              <button
                className="button button-outline"
                onClick={() => setDialog('pipeline')}
              >
                <Plus size={16} /> Novo pipeline
              </button>
            )}
            {data?.permissions.canWrite && (
              <button
                className="button button-dark"
                onClick={() => setDialog('lead')}
                disabled={
                  !data.stages.some((stage) => stage.terminal_state === 'open')
                }
              >
                <Plus size={16} /> Novo lead
              </button>
            )}
          </>
        }
      />

      <div className="mini-stats deskcomm-stats" aria-label="Resumo comercial">
        <Stat value={data?.summary.open ?? 0} label="em aberto" />
        <Stat
          value={money(data?.summary.valueCents ?? 0)}
          label="valor no pipeline"
        />
        <Stat value={data?.summary.atRisk ?? 0} label="pedem atenção" />
        <Stat value={data?.summary.won ?? 0} label="ganhos" />
      </div>

      {(feedback || error) && (
        <div
          className={error ? 'form-error' : 'form-success'}
          role="status"
          aria-live="polite"
        >
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

      <section className="card deskcomm-toolbar">
        <label className="compact-select">
          <span>Pipeline</span>
          <select
            value={pipelineId ?? ''}
            onChange={(event) => void load(event.target.value)}
          >
            {data?.pipelines.map((pipeline) => (
              <option value={pipeline.id} key={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field deskcomm-search">
          <span className="sr-only">Buscar leads</span>
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar lead, contato, responsável ou tag…"
          />
        </label>
        <button
          className="icon-button"
          onClick={() => void load(pipelineId)}
          aria-label="Atualizar pipeline"
          disabled={loading}
        >
          <RefreshCw className={loading ? 'spin' : ''} size={17} />
        </button>
      </section>

      {loading && !data ? (
        <div className="card deskcomm-loading">
          <LoaderCircle className="spin" size={22} /> Carregando pipeline…
        </div>
      ) : !data?.pipelines.length ? (
        <div className="card deskcomm-empty">
          <strong>Nenhum pipeline disponível.</strong>
          <p>
            Crie o primeiro pipeline para começar a organizar oportunidades.
          </p>
        </div>
      ) : (
        <DndContext onDragEnd={handleDragEnd}>
          <div className="crm-board" aria-label="Pipeline comercial">
            {data.stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                leads={visibleLeads.filter((lead) => lead.stageId === stage.id)}
                busyLeadId={busyLeadId}
              />
            ))}
          </div>
        </DndContext>
      )}

      {dialog === 'lead' && data && (
        <LeadDialog
          data={data}
          contacts={contacts}
          onClose={() => setDialog(null)}
          onCreated={async () => {
            setDialog(null)
            setFeedback('Lead criado no pipeline.')
            await load(pipelineId)
          }}
          onError={setError}
        />
      )}
      {dialog === 'pipeline' && (
        <PipelineDialog
          onClose={() => setDialog(null)}
          onCreated={async (id) => {
            setDialog(null)
            setFeedback('Pipeline criado com etapas iniciais.')
            await load(id)
          }}
          onError={setError}
        />
      )}
      {lostMove && (
        <LostReasonDialog
          lead={lostMove.lead}
          onClose={() => setLostMove(null)}
          onSubmit={(reason) =>
            void moveLead(lostMove.lead, lostMove.stage, reason)
          }
        />
      )}
    </div>
  )
}

function StageColumn({
  stage,
  leads,
  busyLeadId,
}: {
  stage: Stage
  leads: Lead[]
  busyLeadId: string | null
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  return (
    <section
      ref={setNodeRef}
      className={`crm-stage ${isOver ? 'is-over' : ''}`}
    >
      <header>
        <span className="crm-stage-color" style={{ background: stage.color }} />
        <strong>{stage.name}</strong>
        <span>{leads.length}</span>
      </header>
      <small>
        {money(leads.reduce((sum, lead) => sum + (lead.valueCents ?? 0), 0))}
      </small>
      <div className="crm-stage-list">
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            disabled={busyLeadId === lead.id}
          />
        ))}
        {!leads.length && <p className="crm-stage-empty">Solte um lead aqui</p>}
      </div>
    </section>
  )
}

function LeadCard({ lead, disabled }: { lead: Lead; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: lead.id, disabled })
  const contactName =
    lead.contact?.display_name ??
    lead.contact?.full_name ??
    (lead.contact?.username ? `@${lead.contact.username}` : null) ??
    lead.contact?.phone ??
    lead.contact?.email ??
    'Sem contato vinculado'
  return (
    <article
      ref={setNodeRef}
      className={`crm-lead-card ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform) }}
    >
      <button
        className="crm-drag-handle"
        aria-label={`Mover ${lead.title}`}
        {...listeners}
        {...attributes}
      >
        <GripVertical size={16} />
      </button>
      <div className="crm-lead-heading">
        <strong>{lead.title}</strong>
        {lead.risk && ['em_risco', 'critico'].includes(lead.risk.bucket) && (
          <AlertTriangle
            size={15}
            aria-label={
              lead.risk.bucket === 'critico' ? 'Risco crítico' : 'Em risco'
            }
          />
        )}
      </div>
      <div className="crm-contact-row">
        <Avatar name={contactName} color="#31312d" />
        <span>{contactName}</span>
      </div>
      {lead.valueCents !== null && (
        <span className="crm-card-meta">
          <CircleDollarSign size={14} /> {money(lead.valueCents)}
        </span>
      )}
      <div className="crm-card-footer">
        <span>
          <UserRound size={13} /> {lead.ownerName ?? 'Sem responsável'}
        </span>
        {lead.score?.band && (
          <StatusDot
            tone={
              lead.score.band === 'quente'
                ? 'green'
                : lead.score.band === 'morno'
                  ? 'orange'
                  : 'gray'
            }
          >
            {Math.round(Number(lead.score.probability ?? 0))}%
          </StatusDot>
        )}
      </div>
      {lead.nextActionAt && (
        <span className="crm-next-action">
          <CalendarClock size={13} /> {shortDate(lead.nextActionAt)}
        </span>
      )}
    </article>
  )
}

function LeadDialog({
  data,
  contacts,
  onClose,
  onCreated,
  onError,
}: {
  data: CrmData
  contacts: ContactOption[]
  onClose: () => void
  onCreated: () => Promise<void>
  onError: (message: string) => void
}) {
  const firstStage = data.stages.find(
    (stage) => stage.terminal_state === 'open',
  )
  const [title, setTitle] = useState('')
  const [stageId, setStageId] = useState(firstStage?.id ?? '')
  const [contactId, setContactId] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')
  const [value, setValue] = useState('')
  const [nextActionAt, setNextActionAt] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!data.activePipelineId || !stageId || busy) return
    setBusy(true)
    try {
      await apiFetch('/api/crm', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'lead',
          pipelineId: data.activePipelineId,
          stageId,
          contactId: contactId || null,
          title,
          ownerUserId: ownerUserId || null,
          valueCents: value
            ? Math.round(Number(value.replace(',', '.')) * 100)
            : null,
          nextActionAt: nextActionAt
            ? new Date(nextActionAt).toISOString()
            : null,
          source: 'manual',
          tags: [],
        }),
      })
      await onCreated()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Falha ao criar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Novo lead" onClose={onClose}>
      <form className="deskcomm-form" onSubmit={submit}>
        <label>
          Título
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={160}
            autoFocus
          />
        </label>
        <label>
          Etapa inicial
          <select
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
          >
            {data.stages
              .filter((stage) => stage.terminal_state === 'open')
              .map((stage) => (
                <option value={stage.id} key={stage.id}>
                  {stage.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Contato vinculado
          <select
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
          >
            <option value="">Sem contato</option>
            {contacts.map((contact) => (
              <option value={contact.id} key={contact.id}>
                {contact.name} · {contact.identity}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsável
          <select
            value={ownerUserId}
            onChange={(event) => setOwnerUserId(event.target.value)}
          >
            <option value="">Sem responsável</option>
            {data.members.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <div className="deskcomm-form-grid">
          <label>
            Valor (R$)
            <input
              type="number"
              min="0"
              step="0.01"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <label>
            Próxima ação
            <input
              type="datetime-local"
              value={nextActionAt}
              onChange={(event) => setNextActionAt(event.target.value)}
            />
          </label>
        </div>
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
            disabled={busy || !title.trim()}
          >
            {busy && <LoaderCircle className="spin" size={16} />} Criar lead
          </button>
        </div>
      </form>
    </Modal>
  )
}

function PipelineDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void
  onCreated: (id: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await apiFetch<{ id: string }>('/api/crm', {
        method: 'POST',
        body: JSON.stringify({ kind: 'pipeline', name, description }),
      })
      await onCreated(result.id)
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : 'Falha ao criar pipeline.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Novo pipeline" onClose={onClose}>
      <form className="deskcomm-form" onSubmit={submit}>
        <label>
          Nome
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
            autoFocus
          />
        </label>
        <label>
          Descrição
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={3}
          />
        </label>
        <p className="field-help">
          O pipeline nasce com etapas abertas, ganho e perdido. Você poderá
          refiná-las na próxima evolução do módulo.
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
            disabled={busy || !name.trim()}
          >
            {busy && <LoaderCircle className="spin" size={16} />} Criar pipeline
          </button>
        </div>
      </form>
    </Modal>
  )
}

function LostReasonDialog({
  lead,
  onClose,
  onSubmit,
}: {
  lead: Lead
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <Modal title="Marcar oportunidade como perdida" onClose={onClose}>
      <form
        className="deskcomm-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (reason.trim()) onSubmit(reason.trim())
        }}
      >
        <p>
          Registre por que <strong>{lead.title}</strong> foi perdido. Esse dado
          alimenta melhoria de processo e nunca fica implícito.
        </p>
        <label>
          Motivo da perda
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={2}
            maxLength={240}
            rows={3}
            required
            autoFocus
          />
        </label>
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
            disabled={reason.trim().length < 2}
          >
            Confirmar perda
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="deskcomm-modal-backdrop" role="presentation">
      <section
        className="deskcomm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deskcomm-modal-title"
      >
        <header>
          <h3 id="deskcomm-modal-title">{title}</h3>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <Clock3 size={18} />
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  )
}

function money(valueCents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(valueCents / 100)
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
