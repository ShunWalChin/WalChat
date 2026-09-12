/** CRM comercial completo: board/lista, edição, ativos e gestão de pipeline. */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Link, createFileRoute, useBlocker } from '@tanstack/react-router'
import { z } from 'zod'
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  Filter,
  GripVertical,
  KanbanSquare,
  LayoutList,
  Link2,
  LoaderCircle,
  Mail,
  Megaphone,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trophy,
  Upload,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, PageIntro, StatusDot } from '../../components/ui'
import { parseLeadCsv } from '../../features/crm/csv'
import type {
  ActivityType,
  ContactOption,
  CrmData,
  CtwaAttribution,
  Lead,
  LeadActivity,
  LeadStatus,
  Pipeline,
  RiskBucket,
  SortMode,
  Stage,
  ViewMode,
} from '../../features/crm/types'
import {
  contactIdentity,
  dateOnly,
  durationLabel,
  isOverdue,
  leadContactName,
  longDate,
  money,
  parseTags,
  positionBeforeLead,
  scoreTone,
  shortDate,
  stageTypeLabel,
  statusLabel,
  statusTone,
  textPayload,
  toLocalInput,
} from '../../features/crm/utils'
import { apiFetch, apiFetchText } from '../../lib/api-client'
import { getBrowserSupabase } from '../../lib/supabase'
import './deskcomm.css'

const crmSearchSchema = z.object({
  pipeline: z.uuid().optional().catch(undefined),
  q: z.string().max(160).optional().catch(undefined),
  owner: z
    .union([z.literal('all'), z.literal('unassigned'), z.uuid()])
    .optional()
    .catch(undefined),
  risk: z
    .enum(['all', 'em_dia', 'em_voo', 'em_risco', 'critico'])
    .optional()
    .catch(undefined),
  status: z.enum(['all', 'open', 'won', 'lost']).optional().catch(undefined),
  tag: z.string().max(40).optional().catch(undefined),
  sort: z
    .enum(['position', 'next-action', 'value-desc', 'recent'])
    .optional()
    .catch(undefined),
  view: z.enum(['board', 'list']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
})

const CONTACTS_LINK_SEARCH = {
  q: '',
  page: 1,
  platform: 'all',
  eligibility: 'all',
  stage: 'all',
  tag: 'all',
  assigned: 'all',
  archived: 'active',
  sort: 'recent',
} as const

export const Route = createFileRoute('/_app/crm')({
  validateSearch: (search) => crmSearchSchema.parse(search),
  component: CrmPage,
})

function CrmPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [data, setData] = useState<CrmData | null>(null)
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const pipelineId = search.pipeline ?? data?.activePipelineId ?? null
  const query = search.q ?? ''
  const ownerFilter = search.owner ?? 'all'
  const riskFilter = search.risk ?? 'all'
  const statusFilter = search.status ?? 'all'
  const tagFilter = search.tag ?? 'all'
  const sortMode: SortMode = search.sort ?? 'position'
  const viewMode: ViewMode = search.view ?? 'board'
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'lead' | 'pipeline' | null>(null)
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [lostMove, setLostMove] = useState<{
    lead: Lead
    stage: Stage
    position: number
  } | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undoMove, setUndoMove] = useState<{
    leadId: string
    title: string
    stageId: string
    position: number
    lostReason: string | null
    expectedLockVersion: number
  } | null>(null)
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set())
  const [bulkStageId, setBulkStageId] = useState('')
  const [bulkOwnerId, setBulkOwnerId] = useState('')
  const [bulkLostReason, setBulkLostReason] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const updateSearch = useCallback(
    (changes: Partial<z.infer<typeof crmSearchSchema>>) =>
      void navigate({
        replace: true,
        search: (current) => ({ ...current, ...changes }),
      }),
    [navigate],
  )

  const load = useCallback(
    async (targetPipelineId?: string | null, background = false) => {
      background ? setRefreshing(true) : setLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(search.page ?? 1),
          pageSize: '100',
          q: search.q ?? '',
          owner: search.owner ?? 'all',
          risk: search.risk ?? 'all',
          status: search.status ?? 'all',
          tag: search.tag ?? 'all',
          sort: search.sort ?? 'position',
        })
        if (targetPipelineId) params.set('pipelineId', targetPipelineId)
        const [crm, contactData] = await Promise.all([
          apiFetch<CrmData>(`/api/crm?${params.toString()}`),
          apiFetch<{ contacts: ContactOption[] }>('/api/contacts?pageSize=200'),
        ])
        setData(crm)
        setContacts(contactData.contacts)
        setError(null)
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Falha ao carregar o CRM.',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [search],
  )

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load(search.pipeline),
      search.q ? 300 : 0,
    )
    return () => window.clearTimeout(timer)
  }, [load, search.pipeline, search.q])

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(null), 4_500)
    return () => window.clearTimeout(timer)
  }, [feedback])

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target?.matches('input, textarea, select, [contenteditable="true"]') ??
        false
      if (
        (!typing && event.key === '/') ||
        (event.ctrlKey && event.key === 'k')
      ) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  useEffect(() => {
    if (!undoMove) return
    const timer = window.setTimeout(() => setUndoMove(null), 10_000)
    return () => window.clearTimeout(timer)
  }, [undoMove])

  const tags = useMemo(
    () =>
      Array.from(
        new Set((data?.leads ?? []).flatMap((lead) => lead.tags)),
      ).sort((left, right) => left.localeCompare(right, 'pt-BR')),
    [data?.leads],
  )

  const visibleLeads = data?.leads ?? []

  const selectedLead =
    data?.leads.find((lead) => lead.id === selectedLeadId) ?? null
  const editingLead =
    data?.leads.find((lead) => lead.id === editingLeadId) ?? null
  const filtersActive =
    Boolean(query.trim()) ||
    ownerFilter !== 'all' ||
    riskFilter !== 'all' ||
    statusFilter !== 'all' ||
    tagFilter !== 'all'
  const selectedLeads = (data?.leads ?? []).filter((lead) =>
    selectedLeadIds.has(lead.id),
  )

  useEffect(() => {
    setSelectedLeadIds(new Set())
  }, [data?.pagination.page, pipelineId])

  function clearFilters() {
    updateSearch({
      q: '',
      owner: 'all',
      risk: 'all',
      status: 'all',
      tag: 'all',
      page: 1,
    })
  }

  function destinationPosition(stageId: string, leadId: string) {
    const greatest = Math.max(
      0,
      ...(data?.leads ?? [])
        .filter((lead) => lead.stageId === stageId && lead.id !== leadId)
        .map((lead) => lead.position),
    )
    return Math.min(999_999_999, greatest + 1000)
  }

  async function runBulkAction(kind: 'move' | 'assign') {
    if (!selectedLeads.length || bulkBusy) return
    const targetStage = data?.stages.find((stage) => stage.id === bulkStageId)
    if (kind === 'move' && !targetStage) {
      setError('Escolha a etapa de destino.')
      return
    }
    if (
      kind === 'move' &&
      targetStage?.terminal_state === 'lost' &&
      bulkLostReason.trim().length < 2
    ) {
      setError('Informe o motivo da perda para mover os leads selecionados.')
      return
    }
    setBulkBusy(true)
    setError(null)
    try {
      await apiFetch('/api/crm/bulk', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          leadIds: selectedLeads.map((lead) => lead.id),
          versions: Object.fromEntries(
            selectedLeads.map((lead) => [lead.id, lead.lockVersion]),
          ),
          ...(kind === 'move'
            ? {
                stageId: targetStage?.id,
                lostReason:
                  targetStage?.terminal_state === 'lost'
                    ? bulkLostReason.trim()
                    : null,
              }
            : { ownerUserId: bulkOwnerId || null }),
        }),
      })
      const count = selectedLeads.length
      setSelectedLeadIds(new Set())
      setBulkLostReason('')
      await reloadAfterChange(
        `${count} ${count === 1 ? 'lead atualizado' : 'leads atualizados'} em massa.`,
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Falha ao atualizar os leads selecionados.',
      )
    } finally {
      setBulkBusy(false)
    }
  }

  async function exportCsv() {
    if (!pipelineId || bulkBusy) return
    setBulkBusy(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        pipelineId,
        q: query,
        owner: ownerFilter,
        risk: riskFilter,
        status: statusFilter,
        tag: tagFilter,
        sort: sortMode,
      })
      const csv = await apiFetchText(`/api/crm/export?${params.toString()}`)
      const url = URL.createObjectURL(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `walchat-crm-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      setFeedback('Exportação CSV preparada com os filtros atuais.')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao exportar o CRM.',
      )
    } finally {
      setBulkBusy(false)
    }
  }

  async function importCsv(file: File) {
    if (!pipelineId || !data || bulkBusy) return
    const firstOpenStage = data.stages.find(
      (stage) => stage.terminal_state === 'open',
    )
    if (!firstOpenStage) {
      setError('Crie uma etapa aberta antes de importar leads.')
      return
    }
    if (file.size > 1_000_000) {
      setError('O CSV deve ter no máximo 1 MB.')
      return
    }
    setBulkBusy(true)
    setError(null)
    try {
      const rows = parseLeadCsv(await file.text())
      const result = await apiFetch<{ count: number }>('/api/crm/bulk', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'import',
          pipelineId,
          stageId: firstOpenStage.id,
          rows,
        }),
      })
      await reloadAfterChange(
        `${result.count} ${result.count === 1 ? 'lead importado' : 'leads importados'} com sucesso.`,
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao importar o CSV.',
      )
    } finally {
      setBulkBusy(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  async function requestMove(lead: Lead, stage: Stage, position?: number) {
    if (busyLeadId || (lead.stageId === stage.id && position === undefined))
      return
    const nextPosition = position ?? destinationPosition(stage.id, lead.id)
    if (stage.terminal_state === 'lost' && lead.stageId !== stage.id) {
      setLostMove({ lead, stage, position: nextPosition })
      return
    }
    await moveLead(lead, stage, nextPosition)
  }

  async function moveLead(
    lead: Lead,
    stage: Stage,
    position: number,
    lostReason?: string,
    recordUndo = true,
  ) {
    if (busyLeadId) return
    const previous = data
    const status = stage.terminal_state
    setBusyLeadId(lead.id)
    setError(null)
    setData((current) =>
      current
        ? {
            ...current,
            leads: current.leads.map((item) =>
              item.id === lead.id
                ? { ...item, stageId: stage.id, status, position }
                : item,
            ),
          }
        : current,
    )
    try {
      const updated = await apiFetch<{
        stage_id: string
        status: LeadStatus
        lock_version: number
      }>(`/api/crm/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          kind: 'move',
          stageId: stage.id,
          position,
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
                      position,
                      lostReason:
                        updated.status === 'lost' ? (lostReason ?? null) : null,
                    }
                  : item,
              ),
            }
          : current,
      )
      setUndoMove(
        recordUndo
          ? {
              leadId: lead.id,
              title: lead.title,
              stageId: lead.stageId,
              position: lead.position,
              lostReason: lead.lostReason,
              expectedLockVersion: updated.lock_version,
            }
          : null,
      )
      setFeedback(`${lead.title} movido para ${stage.name}.`)
      setLostMove(null)
      await load(pipelineId, true)
    } catch (caught) {
      setData(previous)
      setError(
        caught instanceof Error ? caught.message : 'Falha ao mover o lead.',
      )
    } finally {
      setBusyLeadId(null)
    }
  }

  async function undoLastMove() {
    if (!undoMove || busyLeadId || !data) return
    const lead = data.leads.find((item) => item.id === undoMove.leadId)
    const stage = data.stages.find((item) => item.id === undoMove.stageId)
    if (!lead || !stage) {
      setUndoMove(null)
      setError(
        'Não foi possível desfazer: o lead ou a etapa não está mais disponível.',
      )
      return
    }
    await moveLead(
      { ...lead, lockVersion: undoMove.expectedLockVersion },
      stage,
      undoMove.position,
      undoMove.lostReason ?? undefined,
      false,
    )
    setFeedback(`Movimentação de ${undoMove.title} desfeita.`)
  }

  function handleDragEnd(event: DragEndEvent) {
    const lead = data?.leads.find((item) => item.id === String(event.active.id))
    const overId = String(event.over?.id ?? '')
    const targetLead = overId.startsWith('lead:')
      ? data?.leads.find((item) => item.id === overId.slice(5))
      : null
    const stage = data?.stages.find((item) =>
      targetLead ? item.id === targetLead.stageId : item.id === overId,
    )
    if (!lead || !stage || targetLead?.id === lead.id) return
    if (!targetLead && lead.stageId === stage.id) return
    if (targetLead && lead.stageId === stage.id && sortMode !== 'position') {
      setFeedback('Use “Ordem do pipeline” para reordenar dentro da etapa.')
      return
    }
    const targetPosition = targetLead
      ? positionBeforeLead(data?.leads ?? [], targetLead, lead.id)
      : undefined
    void requestMove(lead, stage, targetPosition)
  }

  async function reloadAfterChange(message: string) {
    setFeedback(message)
    await load(pipelineId, true)
  }

  return (
    <div className="stack-lg deskcomm-page crm-workspace-page">
      <PageIntro
        title="Pipeline comercial"
        description="Organize oportunidades, próximos passos, responsáveis e histórico em um fluxo único — do primeiro contato ao fechamento."
        actions={
          <>
            {data?.permissions.canManagePipelines && (
              <button
                className="button button-outline"
                onClick={() => setDialog('pipeline')}
              >
                <Settings2 size={16} /> Gerenciar pipeline
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

      <CrmMetrics data={data} />

      {(feedback || error) && (
        <div
          className={
            error ? 'form-error crm-feedback' : 'form-success crm-feedback'
          }
          role={error ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span>{error ?? feedback}</span>
          {!error && undoMove && (
            <button
              type="button"
              className="button button-ghost compact"
              onClick={() => void undoLastMove()}
              disabled={Boolean(busyLeadId)}
            >
              Desfazer
            </button>
          )}
          <button
            className="icon-button compact"
            aria-label="Fechar aviso"
            onClick={() => {
              setError(null)
              setFeedback(null)
              setUndoMove(null)
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <section
        className="card crm-control-center"
        aria-label="Controles do CRM"
      >
        <div className="crm-primary-controls">
          <label className="compact-select crm-pipeline-select">
            <span>Pipeline</span>
            <select
              value={pipelineId ?? ''}
              onChange={(event) => {
                setSelectedLeadId(null)
                updateSearch({ pipeline: event.target.value, page: 1 })
              }}
            >
              {data?.pipelines.map((pipeline) => (
                <option value={pipeline.id} key={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </label>
          <label className="search-field crm-main-search">
            <span className="sr-only">Buscar leads</span>
            <Search size={17} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) =>
                updateSearch({ q: event.target.value, page: 1 })
              }
              placeholder="Buscar lead, contato, empresa, responsável, tag ou atributo… (/ ou Ctrl+K)"
              type="search"
            />
            {query && (
              <button
                type="button"
                className="crm-search-clear"
                aria-label="Limpar busca"
                onClick={() => updateSearch({ q: '', page: 1 })}
              >
                <X size={15} />
              </button>
            )}
          </label>
          <div className="crm-view-switch" aria-label="Visualização">
            <button
              type="button"
              className={viewMode === 'board' ? 'is-active' : ''}
              aria-pressed={viewMode === 'board'}
              onClick={() => updateSearch({ view: 'board' })}
            >
              <KanbanSquare size={16} /> Quadro
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'is-active' : ''}
              aria-pressed={viewMode === 'list'}
              onClick={() => updateSearch({ view: 'list' })}
            >
              <LayoutList size={16} /> Lista
            </button>
          </div>
          <button
            className="icon-button"
            onClick={() => void load(pipelineId, true)}
            aria-label="Atualizar pipeline"
            disabled={loading || refreshing}
          >
            <RefreshCw
              className={loading || refreshing ? 'spin' : ''}
              size={17}
            />
          </button>
        </div>

        <div className="crm-filter-row">
          <span className="crm-filter-label">
            <Filter size={15} /> Filtrar
          </span>
          <label>
            <span className="sr-only">Responsável</span>
            <select
              value={ownerFilter}
              onChange={(event) =>
                updateSearch({ owner: event.target.value, page: 1 })
              }
              aria-label="Filtrar por responsável"
            >
              <option value="all">Todos os responsáveis</option>
              <option value="unassigned">Sem responsável</option>
              {data?.members.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Risco</span>
            <select
              value={riskFilter}
              onChange={(event) =>
                updateSearch({
                  risk: event.target.value as typeof search.risk,
                  page: 1,
                })
              }
              aria-label="Filtrar por risco"
            >
              <option value="all">Todos os riscos</option>
              <option value="critico">Crítico</option>
              <option value="em_risco">Em risco</option>
              <option value="em_voo">Com ação agendada</option>
              <option value="em_dia">Em dia</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Situação</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                updateSearch({
                  status: event.target.value as typeof search.status,
                  page: 1,
                })
              }
              aria-label="Filtrar por situação"
            >
              <option value="all">Todas as situações</option>
              <option value="open">Em aberto</option>
              <option value="won">Ganhos</option>
              <option value="lost">Perdidos</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Tag</span>
            <select
              value={tagFilter}
              onChange={(event) =>
                updateSearch({ tag: event.target.value, page: 1 })
              }
              aria-label="Filtrar por tag"
            >
              <option value="all">Todas as tags</option>
              {tags.map((tag) => (
                <option value={tag} key={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Ordenação</span>
            <select
              value={sortMode}
              onChange={(event) =>
                updateSearch({
                  sort: event.target.value as SortMode,
                  page: 1,
                })
              }
              aria-label="Ordenar leads"
            >
              <option value="position">Ordem do pipeline</option>
              <option value="next-action">Próxima ação</option>
              <option value="value-desc">Maior valor</option>
              <option value="recent">Atualizados recentemente</option>
            </select>
          </label>
          <span className="crm-result-count" role="status">
            {visibleLeads.length} de {data?.pagination.total ?? 0} leads
          </span>
          {filtersActive && (
            <button
              className="button button-ghost compact"
              onClick={clearFilters}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </section>

      {data?.permissions.canWrite && (
        <section
          className="card crm-bulk-toolbar"
          aria-label="Operações em massa"
        >
          <div className="crm-bulk-heading">
            <div>
              <strong>Operações em massa</strong>
              <span>
                {selectedLeads.length
                  ? `${selectedLeads.length} selecionado${selectedLeads.length === 1 ? '' : 's'} nesta página`
                  : viewMode === 'list'
                    ? 'Selecione leads na primeira coluna da lista.'
                    : 'Abra a visualização em lista para selecionar leads.'}
              </span>
            </div>
            <div className="crm-bulk-file-actions">
              <input
                ref={importInputRef}
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                aria-label="Selecionar arquivo CSV para importar"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importCsv(file)
                }}
              />
              <button
                type="button"
                className="button button-outline"
                disabled={bulkBusy}
                onClick={() => importInputRef.current?.click()}
              >
                <Upload size={16} /> Importar CSV
              </button>
              <button
                type="button"
                className="button button-outline"
                disabled={bulkBusy || !pipelineId}
                onClick={() => void exportCsv()}
              >
                <Download size={16} /> Exportar resultados
              </button>
            </div>
          </div>

          {selectedLeads.length > 0 && (
            <div className="crm-bulk-actions">
              <label>
                <span>Etapa de destino</span>
                <select
                  value={bulkStageId}
                  onChange={(event) => setBulkStageId(event.target.value)}
                >
                  <option value="">Escolha uma etapa</option>
                  {data.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </label>
              {data.stages.find((stage) => stage.id === bulkStageId)
                ?.terminal_state === 'lost' && (
                <label className="crm-bulk-reason">
                  <span>Motivo da perda</span>
                  <input
                    value={bulkLostReason}
                    onChange={(event) => setBulkLostReason(event.target.value)}
                    maxLength={240}
                    required
                  />
                </label>
              )}
              <button
                type="button"
                className="button button-dark"
                disabled={bulkBusy || !bulkStageId}
                onClick={() => void runBulkAction('move')}
              >
                {bulkBusy && <LoaderCircle className="spin" size={16} />}
                Mover selecionados
              </button>
              <label>
                <span>Novo responsável</span>
                <select
                  value={bulkOwnerId}
                  onChange={(event) => setBulkOwnerId(event.target.value)}
                >
                  <option value="">Sem responsável</option>
                  {data.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button-outline"
                disabled={bulkBusy}
                onClick={() => void runBulkAction('assign')}
              >
                Atribuir responsável
              </button>
              <button
                type="button"
                className="button button-ghost"
                disabled={bulkBusy}
                onClick={() => setSelectedLeadIds(new Set())}
              >
                Limpar seleção
              </button>
            </div>
          )}
        </section>
      )}

      {loading && !data ? (
        <CrmLoading />
      ) : !data?.pipelines.length ? (
        <div className="card deskcomm-empty crm-zero-state">
          <BriefcaseBusiness size={28} />
          <strong>Crie o primeiro pipeline comercial.</strong>
          <p>
            Ele começa com etapas abertas, ganho e perdido para você organizar
            as oportunidades desde o primeiro dia.
          </p>
          {data?.permissions.canManagePipelines && (
            <button
              className="button button-dark"
              onClick={() => setDialog('pipeline')}
            >
              <Plus size={16} /> Criar pipeline
            </button>
          )}
        </div>
      ) : viewMode === 'board' ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="crm-board-shell">
            <div className="crm-board-hint" aria-hidden="true">
              Arraste pelo puxador ou abra um lead para mudar de etapa.
            </div>
            <div className="crm-board" aria-label="Pipeline comercial">
              {data.stages.map((stage) => (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  leads={visibleLeads.filter(
                    (lead) => lead.stageId === stage.id,
                  )}
                  busyLeadId={busyLeadId}
                  canWrite={data.permissions.canWrite}
                  onOpen={setSelectedLeadId}
                  onCreate={() => setDialog('lead')}
                />
              ))}
            </div>
          </div>
        </DndContext>
      ) : (
        <LeadList
          leads={visibleLeads}
          stages={data.stages}
          onOpen={setSelectedLeadId}
          onClear={clearFilters}
          filtersActive={filtersActive}
          selectedIds={selectedLeadIds}
          onSelectionChange={setSelectedLeadIds}
        />
      )}

      {data && data.pagination.totalPages > 1 && (
        <nav className="crm-pagination" aria-label="Paginação dos leads">
          <button
            type="button"
            className="button button-outline"
            disabled={data.pagination.page <= 1 || loading || refreshing}
            onClick={() => updateSearch({ page: data.pagination.page - 1 })}
          >
            <ArrowDown className="crm-pagination-previous" size={16} />
            Página anterior
          </button>
          <span aria-live="polite">
            Página {data.pagination.page} de {data.pagination.totalPages}
          </span>
          <button
            type="button"
            className="button button-outline"
            disabled={
              data.pagination.page >= data.pagination.totalPages ||
              loading ||
              refreshing
            }
            onClick={() => updateSearch({ page: data.pagination.page + 1 })}
          >
            Próxima página
            <ArrowDown className="crm-pagination-next" size={16} />
          </button>
        </nav>
      )}

      {dialog === 'lead' && data && (
        <LeadDialog
          data={data}
          contacts={contacts}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null)
            await reloadAfterChange('Lead criado e adicionado ao pipeline.')
          }}
          onError={setError}
        />
      )}

      {editingLead && data && (
        <LeadDialog
          data={data}
          contacts={contacts}
          lead={editingLead}
          onClose={() => setEditingLeadId(null)}
          onSaved={async () => {
            setEditingLeadId(null)
            await reloadAfterChange('Alterações do lead salvas.')
          }}
          onError={setError}
        />
      )}

      {dialog === 'pipeline' && data && (
        <PipelineManager
          data={data}
          pipeline={
            data.pipelines.find((item) => item.id === pipelineId) ?? null
          }
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            setDialog(null)
            setFeedback('Pipeline criado com etapas iniciais.')
            updateSearch({ pipeline: id, page: 1 })
          }}
          onChanged={async (message) => {
            await reloadAfterChange(message)
          }}
          onError={setError}
        />
      )}

      {selectedLead && data && (
        <LeadPanel
          lead={selectedLead}
          stages={data.stages}
          canWrite={data.permissions.canWrite}
          busy={busyLeadId === selectedLead.id}
          onClose={() => setSelectedLeadId(null)}
          onEdit={() => {
            setSelectedLeadId(null)
            setEditingLeadId(selectedLead.id)
          }}
          onMove={(stage) => void requestMove(selectedLead, stage)}
          onChanged={async (message) => {
            await reloadAfterChange(message)
          }}
          onError={setError}
        />
      )}

      {lostMove && (
        <LostReasonDialog
          lead={lostMove.lead}
          onClose={() => setLostMove(null)}
          onSubmit={(reason) =>
            void moveLead(
              lostMove.lead,
              lostMove.stage,
              lostMove.position,
              reason,
            )
          }
        />
      )}
    </div>
  )
}

function CrmMetrics({ data }: { data: CrmData | null }) {
  const metrics = [
    {
      icon: <BriefcaseBusiness />,
      value: data?.summary.open ?? 0,
      label: 'oportunidades abertas',
      detail: `${data?.summary.unassigned ?? 0} sem responsável`,
    },
    {
      icon: <CircleDollarSign />,
      value: money(data?.summary.valueCents ?? 0),
      label: 'valor em aberto',
      detail: `${money(data?.summary.weightedValueCents ?? 0)} ponderado`,
    },
    {
      icon: <AlertTriangle />,
      value: data?.summary.atRisk ?? 0,
      label: 'pedem atenção',
      detail: `${data?.summary.overdue ?? 0} ações atrasadas`,
      tone: 'warning',
    },
    {
      icon: <Trophy />,
      value: data?.summary.won ?? 0,
      label: 'negócios ganhos',
      detail: `${data?.summary.lost ?? 0} perdidos`,
      tone: 'success',
    },
  ]
  return (
    <div className="crm-metrics" aria-label="Resumo comercial">
      {metrics.map((metric) => (
        <article
          className={metric.tone ? `is-${metric.tone}` : ''}
          key={metric.label}
        >
          <span className="crm-metric-icon">{metric.icon}</span>
          <span>
            <strong>{metric.value}</strong>
            <small>{metric.label}</small>
          </span>
          <em>{metric.detail}</em>
        </article>
      ))}
    </div>
  )
}

function StageColumn({
  stage,
  leads,
  busyLeadId,
  canWrite,
  onOpen,
  onCreate,
}: {
  stage: Stage
  leads: Lead[]
  busyLeadId: string | null
  canWrite: boolean
  onOpen: (id: string) => void
  onCreate: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const stageValue = leads.reduce(
    (sum, lead) => sum + (lead.valueCents ?? 0),
    0,
  )
  return (
    <section
      ref={setNodeRef}
      className={`crm-stage ${isOver ? 'is-over' : ''}`}
      aria-labelledby={`stage-${stage.id}`}
    >
      <header className="crm-stage-header">
        <div>
          <span
            className="crm-stage-color"
            style={{ background: stage.color }}
          />
          <strong id={`stage-${stage.id}`}>{stage.name}</strong>
          <span className="crm-stage-count">{leads.length}</span>
        </div>
        <small>{money(stageValue)}</small>
      </header>
      <div className="crm-stage-list">
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            disabled={busyLeadId === lead.id || !canWrite}
            busy={busyLeadId === lead.id}
            onOpen={() => onOpen(lead.id)}
          />
        ))}
        {!leads.length && (
          <div className="crm-stage-empty">
            <span>Solte uma oportunidade aqui</span>
            {canWrite && stage.terminal_state === 'open' && (
              <button type="button" onClick={onCreate}>
                <Plus size={14} /> Adicionar lead
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function LeadCard({
  lead,
  disabled,
  busy,
  onOpen,
}: {
  lead: Lead
  disabled: boolean
  busy: boolean
  onOpen: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: lead.id, disabled })
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: `lead:${lead.id}`,
  })
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDraggableNodeRef(node)
      setDroppableNodeRef(node)
    },
    [setDraggableNodeRef, setDroppableNodeRef],
  )
  const contactName = leadContactName(lead)
  const overdue = isOverdue(lead.nextActionAt) && lead.status === 'open'
  return (
    <article
      ref={setNodeRef}
      className={`crm-lead-card ${isDragging ? 'is-dragging' : ''} ${isOver && !isDragging ? 'is-drop-target' : ''}`}
      style={{ transform: CSS.Translate.toString(transform) }}
      aria-busy={busy}
    >
      <button
        className="crm-drag-handle"
        aria-label={`Arrastar ${lead.title} para outra etapa`}
        disabled={disabled}
        {...listeners}
        {...attributes}
      >
        {busy ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <GripVertical size={17} />
        )}
      </button>
      <button type="button" className="crm-lead-open" onClick={onOpen}>
        <span className="crm-lead-heading">
          <strong>{lead.title}</strong>
          {lead.risk && ['em_risco', 'critico'].includes(lead.risk.bucket) && (
            <RiskMark risk={lead.risk} />
          )}
        </span>
        <span className="crm-contact-row">
          <Avatar name={contactName} color="#31312d" />
          <span>
            <strong>{contactName}</strong>
            {lead.contact?.company && <small>{lead.contact.company}</small>}
          </span>
        </span>
        <span className="crm-card-value-row">
          <span>
            <CircleDollarSign size={14} />
            {lead.valueCents === null
              ? 'Valor não informado'
              : money(lead.valueCents)}
          </span>
          {lead.score?.band && (
            <StatusDot tone={scoreTone(lead.score.band)}>
              {Math.round(Number(lead.score.probability ?? 0))}%
            </StatusDot>
          )}
        </span>
        {lead.tags.length > 0 && (
          <span className="crm-card-tags">
            {lead.tags.slice(0, 2).map((tag) => (
              <em key={tag}>{tag}</em>
            ))}
            {lead.tags.length > 2 && <em>+{lead.tags.length - 2}</em>}
          </span>
        )}
        <span className="crm-card-footer">
          <span>
            <UserRound size={13} /> {lead.ownerName ?? 'Sem responsável'}
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </span>
        {lead.nextActionAt && (
          <span className={`crm-next-action ${overdue ? 'is-overdue' : ''}`}>
            <CalendarClock size={13} />
            {overdue ? 'Atrasado: ' : 'Próxima: '}
            {shortDate(lead.nextActionAt)}
          </span>
        )}
      </button>
    </article>
  )
}

function LeadList({
  leads,
  stages,
  onOpen,
  onClear,
  filtersActive,
  selectedIds,
  onSelectionChange,
}: {
  leads: Lead[]
  stages: Stage[]
  onOpen: (id: string) => void
  onClear: () => void
  filtersActive: boolean
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
}) {
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]))
  const allSelected =
    leads.length > 0 && leads.every((lead) => selectedIds.has(lead.id))
  return (
    <section className="card crm-list-card" aria-label="Lista de oportunidades">
      {leads.length ? (
        <div className="crm-list-scroll">
          <table className="crm-lead-table">
            <thead>
              <tr>
                <th className="crm-select-column">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos os leads desta página"
                    checked={allSelected}
                    onChange={(event) =>
                      onSelectionChange(
                        event.target.checked
                          ? new Set(leads.map((lead) => lead.id))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th>Oportunidade</th>
                <th>Etapa</th>
                <th>Responsável</th>
                <th>Próxima ação</th>
                <th>Valor</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const stage = stagesById.get(lead.stageId)
                return (
                  <tr key={lead.id}>
                    <td className="crm-select-column">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${lead.title}`}
                        checked={selectedIds.has(lead.id)}
                        onChange={(event) => {
                          const next = new Set(selectedIds)
                          if (event.target.checked) next.add(lead.id)
                          else next.delete(lead.id)
                          onSelectionChange(next)
                        }}
                      />
                    </td>
                    <td>
                      <button type="button" onClick={() => onOpen(lead.id)}>
                        <Avatar name={leadContactName(lead)} color="#31312d" />
                        <span>
                          <strong>{lead.title}</strong>
                          <small>{leadContactName(lead)}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="crm-stage-pill">
                        <i style={{ background: stage?.color }} />
                        {stage?.name ?? 'Etapa'}
                      </span>
                    </td>
                    <td>{lead.ownerName ?? 'Sem responsável'}</td>
                    <td
                      className={
                        isOverdue(lead.nextActionAt) ? 'is-overdue' : ''
                      }
                    >
                      {lead.nextActionAt
                        ? shortDate(lead.nextActionAt)
                        : 'Não definida'}
                    </td>
                    <td>
                      {lead.valueCents === null ? '—' : money(lead.valueCents)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Abrir ${lead.title}`}
                        onClick={() => onOpen(lead.id)}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="crm-inline-empty">
          <Search size={24} />
          <strong>Nenhum lead corresponde aos filtros.</strong>
          <p>Ajuste a busca ou remova os filtros para recuperar o quadro.</p>
          {filtersActive && (
            <button className="button button-outline" onClick={onClear}>
              Limpar filtros
            </button>
          )}
        </div>
      )}
    </section>
  )
}

type CustomFieldRow = {
  id: string
  key: string
  value: string
  originalValue: string | number | boolean | null
}

type LeadDraft = {
  title: string
  description: string
  stageId: string
  contactId: string
  ownerUserId: string
  value: string
  nextActionAt: string
  expectedCloseDate: string
  source: string
  tags: string
  customFields: CustomFieldRow[]
}

function LeadDialog({
  data,
  contacts,
  lead,
  onClose,
  onSaved,
  onError,
}: {
  data: CrmData
  contacts: ContactOption[]
  lead?: Lead
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const firstOpenStage = data.stages.find(
    (stage) => stage.terminal_state === 'open',
  )
  const [title, setTitle] = useState(lead?.title ?? '')
  const [description, setDescription] = useState(lead?.description ?? '')
  const [stageId, setStageId] = useState(
    lead?.stageId ?? firstOpenStage?.id ?? '',
  )
  const [contactId, setContactId] = useState(lead?.contactId ?? '')
  const [ownerUserId, setOwnerUserId] = useState(lead?.ownerUserId ?? '')
  const [value, setValue] = useState(
    lead?.valueCents === null || lead?.valueCents === undefined
      ? ''
      : String(lead.valueCents / 100),
  )
  const [nextActionAt, setNextActionAt] = useState(
    toLocalInput(lead?.nextActionAt),
  )
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    lead?.expectedCloseDate?.slice(0, 10) ?? '',
  )
  const [source, setSource] = useState(lead?.source ?? 'manual')
  const [tags, setTags] = useState(lead?.tags.join(', ') ?? '')
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>(
    Object.entries(lead?.customFields ?? {}).map(([key, fieldValue]) => ({
      id: crypto.randomUUID(),
      key,
      value: String(fieldValue ?? ''),
      originalValue: fieldValue,
    })),
  )
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const savedRef = useRef(false)
  const draftKey = `walchat:crm:lead-draft:${data.activePipelineId}`
  const draft = useMemo<LeadDraft>(
    () => ({
      title,
      description,
      stageId,
      contactId,
      ownerUserId,
      value,
      nextActionAt,
      expectedCloseDate,
      source,
      tags,
      customFields,
    }),
    [
      contactId,
      customFields,
      description,
      expectedCloseDate,
      nextActionAt,
      ownerUserId,
      source,
      stageId,
      tags,
      title,
      value,
    ],
  )
  const initialDraftRef = useRef(JSON.stringify(draft))
  const dirty = JSON.stringify(draft) !== initialDraftRef.current

  useEffect(() => {
    if (lead || typeof window === 'undefined') return
    try {
      const stored = window.sessionStorage.getItem(draftKey)
      if (!stored) return
      const recovered = JSON.parse(stored) as Partial<LeadDraft>
      if (!recovered.title && !recovered.description) return
      setTitle(recovered.title ?? '')
      setDescription(recovered.description ?? '')
      setStageId(recovered.stageId || firstOpenStage?.id || '')
      setContactId(recovered.contactId ?? '')
      setOwnerUserId(recovered.ownerUserId ?? '')
      setValue(recovered.value ?? '')
      setNextActionAt(recovered.nextActionAt ?? '')
      setExpectedCloseDate(recovered.expectedCloseDate ?? '')
      setSource(recovered.source ?? 'manual')
      setTags(recovered.tags ?? '')
      setCustomFields(
        Array.isArray(recovered.customFields) ? recovered.customFields : [],
      )
      setDraftRestored(true)
    } catch {
      window.sessionStorage.removeItem(draftKey)
    }
  }, [draftKey, firstOpenStage?.id, lead])

  useEffect(() => {
    if (lead || !dirty || savedRef.current || typeof window === 'undefined')
      return
    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(draftKey, JSON.stringify(draft))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [draft, draftKey, dirty, lead])

  useBlocker({
    shouldBlockFn: () =>
      dirty &&
      !savedRef.current &&
      !window.confirm(
        'Há alterações não salvas neste lead. Deseja sair e manter o rascunho para continuar depois?',
      ),
    enableBeforeUnload: () => dirty && !savedRef.current,
  })

  function closeDialog() {
    if (
      dirty &&
      !savedRef.current &&
      !window.confirm(
        'Há alterações não salvas. Deseja fechar e manter o rascunho para continuar depois?',
      )
    )
      return
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const numericValue = value.trim() === '' ? null : Number(value)
    if (
      numericValue !== null &&
      (!Number.isFinite(numericValue) || numericValue < 0)
    ) {
      setFieldError('Informe um valor válido, igual ou maior que zero.')
      return
    }
    const populatedFields = customFields.filter(
      (field) => field.key.trim() || field.value.trim(),
    )
    const keys = populatedFields.map((field) =>
      field.key.trim().toLocaleLowerCase('pt-BR'),
    )
    if (keys.some((key) => !key)) {
      setFieldError('Dê um nome para cada atributo personalizado.')
      return
    }
    if (new Set(keys).size !== keys.length) {
      setFieldError('Cada atributo personalizado precisa ter um nome único.')
      return
    }

    const common = {
      contactId: contactId || null,
      title: title.trim(),
      description: description.trim() || null,
      ownerUserId: ownerUserId || null,
      valueCents: numericValue === null ? null : Math.round(numericValue * 100),
      expectedCloseDate: expectedCloseDate || null,
      nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : null,
      source: source.trim() || 'manual',
      tags: parseTags(tags),
      customFields: Object.fromEntries(
        populatedFields.map((field) => [
          field.key.trim(),
          field.value === String(field.originalValue ?? '')
            ? field.originalValue
            : field.value.trim(),
        ]),
      ),
    }

    setBusy(true)
    setFieldError(null)
    try {
      if (lead) {
        await apiFetch(`/api/crm/${lead.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            kind: 'update',
            expectedLockVersion: lead.lockVersion,
            ...common,
          }),
        })
      } else {
        await apiFetch('/api/crm', {
          method: 'POST',
          body: JSON.stringify({
            kind: 'lead',
            pipelineId: data.activePipelineId,
            stageId,
            ...common,
          }),
        })
      }
      savedRef.current = true
      if (!lead && typeof window !== 'undefined') {
        window.sessionStorage.removeItem(draftKey)
      }
      await onSaved()
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : 'Não foi possível salvar o lead.'
      setFieldError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={lead ? 'Editar oportunidade' : 'Novo lead'}
      description={
        lead
          ? 'Atualize os dados usados pelo time para conduzir esta oportunidade.'
          : 'Registre o contexto comercial e deixe o próximo passo claro desde o início.'
      }
      onClose={closeDialog}
      wide
    >
      <form className="crm-form" onSubmit={submit}>
        {draftRestored && !lead && (
          <div className="form-success" role="status">
            Recuperamos o rascunho não enviado desta oportunidade.
          </div>
        )}
        <fieldset>
          <legend>Identificação</legend>
          <div className="form-grid two-columns">
            <label>
              Título da oportunidade <span aria-hidden="true">*</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                placeholder="Ex.: Plano empresarial — Acme"
                required
                autoFocus
              />
            </label>
            {!lead && (
              <label>
                Etapa inicial <span aria-hidden="true">*</span>
                <select
                  value={stageId}
                  onChange={(event) => setStageId(event.target.value)}
                  required
                >
                  {data.stages
                    .filter((stage) => stage.terminal_state === 'open')
                    .map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Contato vinculado
              <select
                value={contactId}
                onChange={(event) => setContactId(event.target.value)}
              >
                <option value="">Sem contato vinculado</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} — {contact.identity}
                  </option>
                ))}
              </select>
              <small>
                Não encontrou?{' '}
                <Link to="/contatos" search={CONTACTS_LINK_SEARCH}>
                  Cadastre nos contatos
                </Link>
                .
              </small>
            </label>
            <label>
              Responsável
              <select
                value={ownerUserId}
                onChange={(event) => setOwnerUserId(event.target.value)}
              >
                <option value="">Sem responsável</option>
                {data.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Contexto comercial
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={3000}
              rows={4}
              placeholder="Necessidade, objeções, cenário atual e acordo feito com o lead."
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Negociação e acompanhamento</legend>
          <div className="form-grid three-columns">
            <label>
              Valor estimado (R$)
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
              />
            </label>
            <label>
              Próxima ação
              <input
                value={nextActionAt}
                onChange={(event) => setNextActionAt(event.target.value)}
                type="datetime-local"
              />
            </label>
            <label>
              Fechamento esperado
              <input
                value={expectedCloseDate}
                onChange={(event) => setExpectedCloseDate(event.target.value)}
                type="date"
              />
            </label>
            <label>
              Origem
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                maxLength={60}
                minLength={2}
                placeholder="Ex.: Meta Ads, indicação"
              />
            </label>
            <label className="span-two">
              Tags
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                maxLength={600}
                placeholder="prioridade, inbound, renovação"
              />
              <small>Separe por vírgulas.</small>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Atributos personalizados</legend>
          <div className="crm-fieldset-heading">
            <p>
              Guarde dados próprios da sua operação sem mudar o cadastro padrão.
            </p>
            <button
              type="button"
              className="button button-outline compact"
              onClick={() =>
                setCustomFields((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    key: '',
                    value: '',
                    originalValue: '',
                  },
                ])
              }
            >
              <Plus size={15} /> Adicionar atributo
            </button>
          </div>
          {customFields.length ? (
            <div className="crm-custom-fields">
              {customFields.map((field, index) => (
                <div className="crm-custom-field-row" key={field.id}>
                  <label>
                    Nome
                    <input
                      value={field.key}
                      maxLength={60}
                      placeholder="Ex.: Produto"
                      onChange={(event) =>
                        setCustomFields((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, key: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Valor
                    <input
                      value={field.value}
                      maxLength={500}
                      placeholder="Ex.: Plano Pro"
                      onChange={(event) =>
                        setCustomFields((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remover atributo ${field.key || index + 1}`}
                    onClick={() =>
                      setCustomFields((current) =>
                        current.filter((item) => item.id !== field.id),
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="crm-muted-copy">Nenhum atributo personalizado.</p>
          )}
        </fieldset>

        {fieldError && (
          <div className="form-error" role="alert">
            {fieldError}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={closeDialog}
          >
            Cancelar
          </button>
          <button
            className="button button-dark"
            disabled={busy || !title.trim()}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            {busy ? 'Salvando…' : lead ? 'Salvar alterações' : 'Criar lead'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function LeadPanel({
  lead,
  stages,
  canWrite,
  busy,
  onClose,
  onEdit,
  onMove,
  onChanged,
  onError,
}: {
  lead: Lead
  stages: Stage[]
  canWrite: boolean
  busy: boolean
  onClose: () => void
  onEdit: () => void
  onMove: (stage: Stage) => void
  onChanged: (message: string) => Promise<void>
  onError: (message: string) => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [ctwaAttribution, setCtwaAttribution] =
    useState<CtwaAttribution | null>(null)
  const [loadingActivities, setLoadingActivities] = useState(true)
  const [showComposer, setShowComposer] = useState(false)
  useDialogKeyboard(panelRef, onClose)

  const loadActivities = useCallback(async () => {
    setLoadingActivities(true)
    try {
      const result = await apiFetch<{
        activities: LeadActivity[]
        ctwaAttribution: CtwaAttribution | null
      }>(`/api/crm/${lead.id}`)
      setActivities(result.activities)
      setCtwaAttribution(result.ctwaAttribution)
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível carregar o histórico.',
      )
    } finally {
      setLoadingActivities(false)
    }
  }, [lead.id, onError])

  useEffect(() => void loadActivities(), [loadActivities])

  const currentStage = stages.find((stage) => stage.id === lead.stageId)

  return (
    <div className="crm-drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="crm-lead-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-lead-drawer-title"
        ref={panelRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="crm-drawer-header">
          <div>
            <span className={`status-badge ${statusTone(lead.status)}`}>
              {statusLabel(lead.status)}
            </span>
            <h2 id="crm-lead-drawer-title">{lead.title}</h2>
            <p>
              Criado em {longDate(lead.createdAt)} · atualizado em{' '}
              {longDate(lead.updatedAt)}
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Fechar detalhes"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="crm-drawer-scroll">
          <section
            className="crm-contact-profile"
            aria-label="Contato vinculado"
          >
            <Avatar name={leadContactName(lead)} color="#31312d" />
            <div>
              <strong>{leadContactName(lead)}</strong>
              <span>{contactIdentity(lead.contact)}</span>
              {lead.contact?.company && <small>{lead.contact.company}</small>}
            </div>
            {lead.contactId && (
              <Link
                to="/contatos"
                search={CONTACTS_LINK_SEARCH}
                className="icon-button"
                aria-label="Abrir contatos"
              >
                <ExternalLink size={16} />
              </Link>
            )}
          </section>

          <div className="crm-drawer-actions">
            {canWrite && (
              <>
                <button className="button button-dark" onClick={onEdit}>
                  <Pencil size={15} /> Editar lead
                </button>
                <button
                  className="button button-outline"
                  onClick={() => setShowComposer((current) => !current)}
                  aria-expanded={showComposer}
                >
                  <Plus size={15} /> Registrar atividade
                </button>
              </>
            )}
          </div>

          {canWrite && (
            <section className="crm-drawer-section crm-move-control">
              <div className="crm-section-title">
                <div>
                  <span>Etapa atual</span>
                  <strong>{currentStage?.name ?? 'Etapa'}</strong>
                </div>
                <span className={`status-badge ${statusTone(lead.status)}`}>
                  {stageTypeLabel(currentStage?.terminal_state ?? lead.status)}
                </span>
              </div>
              <label>
                Mover para
                <select
                  value={lead.stageId}
                  disabled={busy}
                  onChange={(event) => {
                    const stage = stages.find(
                      (item) => item.id === event.target.value,
                    )
                    if (stage) onMove(stage)
                  }}
                >
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                Alternativa acessível ao arrastar. Mudanças são registradas no
                histórico.
              </small>
            </section>
          )}

          <section className="crm-drawer-section">
            <h3>Dados comerciais</h3>
            <dl className="crm-detail-grid">
              <Detail
                label="Valor"
                value={lead.valueCents === null ? '—' : money(lead.valueCents)}
              />
              <Detail
                label="Responsável"
                value={lead.ownerName ?? 'Sem responsável'}
              />
              <Detail
                label="Próxima ação"
                value={
                  lead.nextActionAt
                    ? longDate(lead.nextActionAt)
                    : 'Não definida'
                }
                overdue={isOverdue(lead.nextActionAt)}
              />
              <Detail
                label="Fechamento esperado"
                value={
                  lead.expectedCloseDate
                    ? dateOnly(lead.expectedCloseDate)
                    : 'Não definido'
                }
              />
              <Detail label="Origem" value={lead.source || 'Não informada'} />
              <Detail
                label="Score"
                value={
                  lead.score?.probability === null ||
                  lead.score?.probability === undefined
                    ? 'Sem score'
                    : `${lead.score.probability}% · ${lead.score.band ?? 'sem faixa'}`
                }
              />
            </dl>
            {lead.description && (
              <p className="crm-description-copy">{lead.description}</p>
            )}
            {lead.lostReason && (
              <div className="crm-lost-reason">
                <AlertTriangle size={16} />
                <span>
                  <strong>Motivo da perda:</strong> {lead.lostReason}
                </span>
              </div>
            )}
          </section>

          {ctwaAttribution && (
            <section className="crm-drawer-section crm-ctwa-attribution">
              <div className="crm-section-title">
                <div>
                  <span>Origem Meta</span>
                  <strong>
                    <Megaphone size={15} /> Anúncio para WhatsApp
                  </strong>
                </div>
                <StatusDot tone={ctwaAttribution.hasClickId ? 'green' : 'gray'}>
                  {ctwaAttribution.hasClickId
                    ? 'CTWA identificado'
                    : 'Referência sem click ID'}
                </StatusDot>
              </div>
              <dl className="crm-detail-grid">
                <Detail
                  label="Tipo"
                  value={
                    ctwaAttribution.sourceType === 'ad'
                      ? 'Anúncio'
                      : ctwaAttribution.sourceType === 'post'
                        ? 'Publicação'
                        : (ctwaAttribution.sourceType ?? 'Meta')
                  }
                />
                <Detail
                  label="ID da origem"
                  value={ctwaAttribution.sourceId ?? 'Não informado'}
                />
                <Detail
                  label="Criativo"
                  value={ctwaAttribution.mediaType ?? 'Não informado'}
                />
                <Detail
                  label="Primeiro contato"
                  value={
                    ctwaAttribution.receivedAt
                      ? longDate(ctwaAttribution.receivedAt)
                      : 'Não informado'
                  }
                />
              </dl>
              {(ctwaAttribution.headline || ctwaAttribution.body) && (
                <div className="crm-ctwa-creative">
                  {ctwaAttribution.headline && (
                    <strong>{ctwaAttribution.headline}</strong>
                  )}
                  {ctwaAttribution.body && <p>{ctwaAttribution.body}</p>}
                </div>
              )}
              {ctwaAttribution.sourceUrl && (
                <a
                  className="button button-outline"
                  href={ctwaAttribution.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} /> Abrir origem na Meta
                </a>
              )}
              <small>
                O click ID completo fica protegido no servidor e será usado
                somente por uma regra CAPI do tipo WhatsApp — anúncio CTWA.
              </small>
            </section>
          )}

          {(lead.tags.length > 0 ||
            Object.keys(lead.customFields).length > 0) && (
            <section className="crm-drawer-section">
              <h3>Classificação e atributos</h3>
              {lead.tags.length > 0 && (
                <div className="crm-tag-list" aria-label="Tags do lead">
                  {lead.tags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
              )}
              {Object.keys(lead.customFields).length > 0 && (
                <dl className="crm-custom-detail-list">
                  {Object.entries(lead.customFields).map(([key, value]) => (
                    <Detail
                      key={key}
                      label={key}
                      value={String(value ?? '—')}
                    />
                  ))}
                </dl>
              )}
            </section>
          )}

          <section className="crm-drawer-section crm-history-section">
            <div className="crm-section-title">
              <div>
                <span>Histórico</span>
                <strong>Atividades e ativos</strong>
              </div>
              <button
                className="icon-button"
                aria-label="Atualizar histórico"
                onClick={() => void loadActivities()}
                disabled={loadingActivities}
              >
                <RefreshCw
                  className={loadingActivities ? 'spin' : ''}
                  size={16}
                />
              </button>
            </div>

            {showComposer && canWrite && (
              <ActivityComposer
                leadId={lead.id}
                onCancel={() => setShowComposer(false)}
                onSaved={async () => {
                  setShowComposer(false)
                  await loadActivities()
                  await onChanged('Atividade registrada no histórico do lead.')
                }}
                onError={onError}
              />
            )}

            {loadingActivities ? (
              <div className="crm-timeline-loading">
                <LoaderCircle className="spin" size={18} /> Carregando
                histórico…
              </div>
            ) : activities.length ? (
              <ol className="crm-timeline">
                {activities.map((activity) => (
                  <ActivityItem activity={activity} key={activity.id} />
                ))}
              </ol>
            ) : (
              <div className="crm-inline-empty compact">
                <ClipboardList size={22} />
                <strong>Nenhuma atividade registrada.</strong>
                <p>
                  Notas, tarefas, reuniões, links e documentos aparecerão aqui.
                </p>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}

function ActivityComposer({
  leadId,
  onCancel,
  onSaved,
  onError,
}: {
  leadId: string
  onCancel: () => void
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const [type, setType] = useState<ActivityType>('note')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isAsset = type === 'link' || type === 'document'
  const requiresTitle = type !== 'note'

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (type === 'document' && file) {
        const prepared = await apiFetch<{
          bucket: string
          storagePath: string
          token: string
        }>('/api/crm/assets', {
          method: 'POST',
          body: JSON.stringify({
            kind: 'prepare',
            leadId,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        })
        const supabase = getBrowserSupabase()
        if (!supabase)
          throw new Error('Entre com uma conta real para enviar anexos.')
        const uploaded = await supabase.storage
          .from(prepared.bucket)
          .uploadToSignedUrl(prepared.storagePath, prepared.token, file, {
            contentType: file.type,
            upsert: false,
          })
        if (uploaded.error) throw uploaded.error
        await apiFetch('/api/crm/assets', {
          method: 'POST',
          body: JSON.stringify({
            kind: 'register',
            leadId,
            storagePath: prepared.storagePath,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        })
        await onSaved()
        return
      }
      await apiFetch(`/api/crm/${leadId}`, {
        method: 'POST',
        body: JSON.stringify({
          activityType: type,
          title: title.trim() || null,
          body: body.trim() || null,
          url: url.trim() || null,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      })
      await onSaved()
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : 'Falha ao registrar atividade.'
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="crm-activity-composer" onSubmit={submit}>
      <label>
        Tipo de registro
        <select
          value={type}
          onChange={(event) => setType(event.target.value as ActivityType)}
        >
          <option value="note">Nota</option>
          <option value="task">Tarefa</option>
          <option value="call">Ligação</option>
          <option value="meeting">Reunião</option>
          <option value="email">E-mail</option>
          <option value="link">Link</option>
          <option value="document">Documento</option>
        </select>
      </label>
      {requiresTitle && (
        <label>
          Título <span aria-hidden="true">*</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            placeholder={isAsset ? 'Nome do material' : 'Resumo da atividade'}
            required
          />
        </label>
      )}
      {type === 'document' && (
        <label>
          Arquivo local
          <input
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.csv,.txt"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null
              setFile(selected)
              if (selected && !title.trim()) setTitle(selected.name)
            }}
          />
          <small>
            Até 10 MB. O arquivo fica privado e abre por URL temporária.
          </small>
        </label>
      )}
      {isAsset && (!file || type === 'link') && (
        <label>
          {type === 'document' ? 'Ou informe uma URL' : 'URL'}{' '}
          {type === 'link' && <span aria-hidden="true">*</span>}
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            maxLength={1200}
            placeholder="https://…"
            required={type === 'link' || !file}
          />
        </label>
      )}
      {['task', 'call', 'meeting'].includes(type) && (
        <label>
          Data e hora
          <input
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            type="datetime-local"
          />
        </label>
      )}
      <label>
        {type === 'note' ? 'Nota' : 'Detalhes'}{' '}
        {type === 'note' && <span aria-hidden="true">*</span>}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={3000}
          rows={3}
          placeholder="Registre o contexto útil para o próximo atendimento."
          required={type === 'note'}
        />
      </label>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="crm-composer-actions">
        <button
          type="button"
          className="button button-ghost"
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button className="button button-dark" disabled={busy}>
          {busy && <LoaderCircle className="spin" size={15} />}
          {busy ? 'Registrando…' : 'Registrar'}
        </button>
      </div>
    </form>
  )
}

function ActivityItem({ activity }: { activity: LeadActivity }) {
  const presentation = activityPresentation(activity)
  const url = textPayload(activity.payload.url)
  const assetId = textPayload(activity.payload.assetId)
  const body = textPayload(activity.payload.body)
  const dueAt = textPayload(activity.payload.dueAt)
  const [openingAsset, setOpeningAsset] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)

  async function openAsset() {
    if (!assetId || openingAsset) return
    setOpeningAsset(true)
    setAssetError(null)
    try {
      const result = await apiFetch<{ url: string }>(
        `/api/crm/assets/${assetId}`,
      )
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (caught) {
      setAssetError(
        caught instanceof Error ? caught.message : 'Falha ao abrir o anexo.',
      )
    } finally {
      setOpeningAsset(false)
    }
  }
  return (
    <li>
      <span className={`crm-timeline-icon ${presentation.tone}`}>
        {presentation.icon}
      </span>
      <div>
        <div className="crm-activity-heading">
          <strong>{presentation.title}</strong>
          <time dateTime={activity.performedAt}>
            {longDate(activity.performedAt)}
          </time>
        </div>
        {presentation.subtitle && <p>{presentation.subtitle}</p>}
        {body && <p>{body}</p>}
        {dueAt && <small>Agendado para {longDate(dueAt)}</small>}
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Abrir recurso
          </a>
        )}
        {assetId && (
          <button
            type="button"
            className="crm-asset-open"
            onClick={() => void openAsset()}
            disabled={openingAsset}
          >
            {openingAsset ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Download size={14} />
            )}
            {openingAsset ? 'Preparando…' : 'Baixar anexo'}
          </button>
        )}
        {assetError && (
          <small className="form-error" role="alert">
            {assetError}
          </small>
        )}
        <small>por {activity.actorName}</small>
      </div>
    </li>
  )
}

function PipelineManager({
  data,
  pipeline,
  onClose,
  onCreated,
  onChanged,
  onError,
}: {
  data: CrmData
  pipeline: Pipeline | null
  onClose: () => void
  onCreated: (id: string) => Promise<void> | void
  onChanged: (message: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [mode, setMode] = useState<'manage' | 'new-pipeline' | 'stage'>(
    pipeline ? 'manage' : 'new-pipeline',
  )
  const [editingStage, setEditingStage] = useState<Stage | null>(null)
  const [name, setName] = useState(pipeline?.name ?? '')
  const [description, setDescription] = useState(pipeline?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const stages = data.stages

  useEffect(() => {
    setName(pipeline?.name ?? '')
    setDescription(pipeline?.description ?? '')
  }, [pipeline?.description, pipeline?.name])

  async function apiAction(body: Record<string, unknown>, message: string) {
    if (!pipeline) return false
    setBusy(true)
    setLocalError(null)
    try {
      const { kind, ...requestData } = body
      await apiFetch(`/api/crm/pipelines/${pipeline.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ kind, data: requestData }),
      })
      await onChanged(message)
      return true
    } catch (caught) {
      const messageText =
        caught instanceof Error
          ? caught.message
          : 'Não foi possível atualizar o pipeline.'
      setLocalError(messageText)
      onError(messageText)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function savePipeline(event: FormEvent) {
    event.preventDefault()
    await apiAction(
      {
        kind: 'pipeline-update',
        name: name.trim(),
        description: description.trim() || null,
      },
      'Dados do pipeline atualizados.',
    )
  }

  async function reorderStage(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= stages.length) return
    const ordered = [...stages]
    const current = ordered[index]
    const other = ordered[target]
    ordered[index] = other
    ordered[target] = current
    await apiAction(
      { kind: 'stages-reorder', stageIds: ordered.map((stage) => stage.id) },
      'Ordem das etapas atualizada.',
    )
  }

  if (mode === 'new-pipeline') {
    return (
      <PipelineCreateDialog
        onClose={onClose}
        onBack={pipeline ? () => setMode('manage') : undefined}
        onCreated={onCreated}
        onError={onError}
      />
    )
  }

  if (mode === 'stage' && pipeline) {
    return (
      <StageDialog
        stage={editingStage}
        busy={busy}
        onClose={() => {
          setMode('manage')
          setEditingStage(null)
        }}
        onSave={async (values) => {
          const saved = await apiAction(
            editingStage
              ? { kind: 'stage-update', stageId: editingStage.id, ...values }
              : { kind: 'stage-create', ...values },
            editingStage ? 'Etapa atualizada.' : 'Nova etapa adicionada.',
          )
          if (saved) {
            setMode('manage')
            setEditingStage(null)
          }
        }}
        onArchive={
          editingStage
            ? async () => {
                const archived = await apiAction(
                  { kind: 'stage-archive', stageId: editingStage.id },
                  'Etapa arquivada.',
                )
                if (archived) {
                  setMode('manage')
                  setEditingStage(null)
                }
              }
            : undefined
        }
      />
    )
  }

  return (
    <Modal
      title="Gerenciar pipeline"
      description="Ajuste a estrutura comercial sem perder o histórico dos leads."
      onClose={onClose}
      wide
    >
      <form className="crm-form" onSubmit={savePipeline}>
        <fieldset>
          <legend>Identificação</legend>
          <div className="form-grid two-columns">
            <label>
              Nome do pipeline <span aria-hidden="true">*</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                minLength={2}
                required
              />
            </label>
            <label>
              Descrição
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={300}
                placeholder="Explique qual processo este pipeline representa"
              />
            </label>
          </div>
          <div className="crm-inline-actions">
            <button
              className="button button-outline"
              disabled={busy || !name.trim()}
            >
              {busy && <LoaderCircle className="spin" size={15} />}
              Salvar identificação
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setMode('new-pipeline')}
            >
              <Plus size={15} /> Novo pipeline
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Etapas do funil</legend>
          <div className="crm-fieldset-heading">
            <p>A ordem abaixo é a mesma usada no quadro.</p>
            <button
              type="button"
              className="button button-dark compact"
              onClick={() => {
                setEditingStage(null)
                setMode('stage')
              }}
            >
              <Plus size={15} /> Nova etapa
            </button>
          </div>
          <ol className="crm-stage-manager-list">
            {stages.map((stage, index) => {
              const leadCount = data.leads.filter(
                (lead) => lead.stageId === stage.id,
              ).length
              return (
                <li key={stage.id}>
                  <span
                    className="crm-stage-color"
                    style={{ background: stage.color }}
                  />
                  <div>
                    <strong>{stage.name}</strong>
                    <small>
                      {stageTypeLabel(stage.terminal_state)} · {leadCount}{' '}
                      {leadCount === 1 ? 'lead' : 'leads'} · meta de{' '}
                      {durationLabel(stage.expected_duration_hours)}
                    </small>
                  </div>
                  <div className="crm-stage-order-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Mover ${stage.name} para a esquerda`}
                      disabled={busy || index === 0}
                      onClick={() => void reorderStage(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Mover ${stage.name} para a direita`}
                      disabled={busy || index === stages.length - 1}
                      onClick={() => void reorderStage(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="button button-outline compact"
                      onClick={() => {
                        setEditingStage(stage)
                        setMode('stage')
                      }}
                    >
                      <Pencil size={14} /> Editar
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        </fieldset>

        {localError && (
          <div className="form-error" role="alert">
            {localError}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-dark"
            onClick={onClose}
          >
            Concluir
          </button>
        </div>
      </form>
    </Modal>
  )
}

function PipelineCreateDialog({
  onClose,
  onBack,
  onCreated,
  onError,
}: {
  onClose: () => void
  onBack?: () => void
  onCreated: (id: string) => Promise<void> | void
  onError: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await apiFetch<{ id: string }>('/api/crm', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'pipeline',
          name: name.trim(),
          description: description.trim() || null,
        }),
      })
      await onCreated(created.id)
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Falha ao criar o pipeline.'
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Novo pipeline"
      description="Crie um funil separado para outro processo comercial."
      onClose={onClose}
    >
      <form className="crm-form" onSubmit={submit}>
        <label>
          Nome <span aria-hidden="true">*</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            minLength={2}
            placeholder="Ex.: Renovação de contratos"
            autoFocus
            required
          />
        </label>
        <label>
          Descrição
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Qual processo este pipeline acompanha?"
          />
        </label>
        <p className="crm-helper-card">
          <Check size={16} /> O pipeline será criado com etapas iniciais de
          entrada, ganho e perda. Você poderá personalizá-las em seguida.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={onBack ?? onClose}
          >
            {onBack ? 'Voltar' : 'Cancelar'}
          </button>
          <button
            className="button button-dark"
            disabled={busy || !name.trim()}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            {busy ? 'Criando…' : 'Criar pipeline'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function StageDialog({
  stage,
  busy,
  onClose,
  onSave,
  onArchive,
}: {
  stage: Stage | null
  busy: boolean
  onClose: () => void
  onSave: (values: {
    name: string
    description: string | null
    color: string
    terminalState: LeadStatus
    expectedDurationHours: number
    requiresHuman: boolean
  }) => Promise<void>
  onArchive?: () => Promise<void>
}) {
  const [name, setName] = useState(stage?.name ?? '')
  const [description, setDescription] = useState(stage?.description ?? '')
  const [color, setColor] = useState(stage?.color ?? '#246bfd')
  const [terminalState, setTerminalState] = useState<LeadStatus>(
    stage?.terminal_state ?? 'open',
  )
  const [expectedDurationHours, setExpectedDurationHours] = useState(
    stage?.expected_duration_hours ?? 24,
  )
  const [requiresHuman, setRequiresHuman] = useState(
    stage?.requires_human ?? true,
  )

  return (
    <Modal
      title={stage ? 'Editar etapa' : 'Nova etapa'}
      description="Defina como esta fase se comporta no processo comercial."
      onClose={onClose}
    >
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault()
          void onSave({
            name: name.trim(),
            description: description.trim() || null,
            color,
            terminalState,
            expectedDurationHours,
            requiresHuman,
          })
        }}
      >
        <div className="form-grid two-columns">
          <label>
            Nome <span aria-hidden="true">*</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              minLength={2}
              autoFocus
              required
            />
          </label>
          <label>
            Cor
            <span className="crm-color-input">
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
              <code>{color}</code>
            </span>
          </label>
          <label>
            Tipo da etapa
            <select
              value={terminalState}
              onChange={(event) =>
                setTerminalState(event.target.value as LeadStatus)
              }
            >
              <option value="open">Em andamento</option>
              <option value="won">Ganho</option>
              <option value="lost">Perdido</option>
            </select>
          </label>
          <label>
            Tempo esperado (horas)
            <input
              type="number"
              min="1"
              max="8760"
              value={expectedDurationHours}
              onChange={(event) =>
                setExpectedDurationHours(Number(event.target.value))
              }
              required
            />
          </label>
        </div>
        <label>
          Descrição
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Critério para entrar e sair desta etapa"
          />
        </label>
        <label className="crm-checkbox-row">
          <input
            type="checkbox"
            checked={requiresHuman}
            onChange={(event) => setRequiresHuman(event.target.checked)}
          />
          <span>
            <strong>Exige atuação humana</strong>
            <small>
              Ajuda a destacar etapas que não devem depender apenas de
              automação.
            </small>
          </span>
        </label>
        <div className="modal-actions crm-stage-dialog-actions">
          {onArchive && (
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              onClick={() => void onArchive()}
            >
              <Archive size={15} /> Arquivar etapa
            </button>
          )}
          <span />
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
            {busy && <LoaderCircle className="spin" size={15} />}
            Salvar etapa
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
    <Modal
      title="Registrar perda"
      description={`${lead.title} será movido para uma etapa de perda.`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(reason.trim())
        }}
        className="crm-form"
      >
        <label>
          Motivo da perda
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={240}
            minLength={2}
            rows={4}
            placeholder="Ex.: orçamento, prazo, concorrente ou ausência de retorno"
            autoFocus
          />
          <small>
            Esse aprendizado fica disponível no histórico comercial.
          </small>
        </label>
        <div className="modal-actions">
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
  description,
  onClose,
  wide = false,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useMemo(() => `modal-${crypto.randomUUID()}`, [])
  useDialogKeyboard(dialogRef, onClose)
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal-card ${wide ? 'is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function useDialogKeyboard(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const priorFocus = document.activeElement as HTMLElement | null
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const firstFocusable = element.querySelector<HTMLElement>(focusableSelector)
    ;(firstFocusable ?? element).focus()

    function keyDown(event: KeyboardEvent) {
      const activeDialog = ref.current
      if (!activeDialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        activeDialog.querySelectorAll<HTMLElement>(focusableSelector),
      )
      if (!focusable.length) {
        event.preventDefault()
        activeDialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keyDown)
    return () => {
      document.removeEventListener('keydown', keyDown)
      priorFocus?.focus()
    }
  }, [onClose, ref])
}

function Detail({
  label,
  value,
  overdue = false,
}: {
  label: string
  value: string
  overdue?: boolean
}) {
  return (
    <div className={overdue ? 'is-overdue' : ''}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function RiskMark({ risk }: { risk: Lead['risk'] }) {
  if (!risk) return null
  const labels: Record<RiskBucket, string> = {
    em_dia: 'Em dia',
    em_voo: 'Ação agendada',
    em_risco: 'Em risco',
    critico: 'Crítico',
  }
  return (
    <span className={`crm-risk-mark ${risk.bucket}`}>
      {labels[risk.bucket]}
    </span>
  )
}

function CrmLoading() {
  return (
    <div
      className="crm-loading"
      aria-label="Carregando pipeline"
      aria-busy="true"
    >
      {[0, 1, 2].map((column) => (
        <div key={column}>
          <span />
          <i />
          <i />
        </div>
      ))}
    </div>
  )
}

function activityPresentation(activity: LeadActivity) {
  const title = textPayload(activity.payload.title)
  const presentations: Record<
    string,
    { title: string; tone: string; icon: React.ReactNode }
  > = {
    note: {
      title: title || 'Nota adicionada',
      tone: 'blue',
      icon: <MessageSquareText size={15} />,
    },
    task: {
      title: title || 'Tarefa registrada',
      tone: 'orange',
      icon: <ClipboardList size={15} />,
    },
    call: {
      title: title || 'Ligação registrada',
      tone: 'green',
      icon: <Phone size={15} />,
    },
    meeting: {
      title: title || 'Reunião registrada',
      tone: 'violet',
      icon: <UsersRound size={15} />,
    },
    email: {
      title: title || 'E-mail registrado',
      tone: 'blue',
      icon: <Mail size={15} />,
    },
    link: {
      title: title || 'Link adicionado',
      tone: 'green',
      icon: <Link2 size={15} />,
    },
    document: {
      title: title || 'Documento adicionado',
      tone: 'violet',
      icon: <FileText size={15} />,
    },
    lead_created: {
      title: 'Lead criado',
      tone: 'green',
      icon: <Plus size={15} />,
    },
    lead_updated: {
      title: 'Dados do lead atualizados',
      tone: 'blue',
      icon: <Pencil size={15} />,
    },
    stage_moved: {
      title: 'Lead movido no pipeline',
      tone: 'orange',
      icon: <KanbanSquare size={15} />,
    },
    lead_reordered: {
      title: 'Lead reordenado na etapa',
      tone: 'blue',
      icon: <GripVertical size={15} />,
    },
  }
  const presentation = presentations[activity.type] ?? {
    title: title || 'Atividade registrada',
    tone: 'gray',
    icon: <MoreHorizontal size={15} />,
  }
  const subtitle = [
    textPayload(activity.payload.fromStageName),
    textPayload(activity.payload.toStageName),
  ]
    .filter(Boolean)
    .join(' → ')
  return { ...presentation, subtitle }
}
