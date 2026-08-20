/** CRM operacional: busca, filtros, seleção, edição, tags, notas e auditoria. */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Check,
  CircleAlert,
  Download,
  Filter,
  LoaderCircle,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Phone,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Tag,
  Tags,
  Trash2,
  UserRound,
  UserRoundCheck,
  X,
} from 'lucide-react'
import type { ChangeEvent, CSSProperties, FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { Avatar, PageIntro, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

const searchSchema = z.object({
  q: z.string().max(100).catch(''),
  page: z.coerce.number().int().min(1).catch(1),
  platform: z.enum(['all', 'instagram', 'whatsapp', 'manual']).catch('all'),
  eligibility: z
    .enum([
      'all',
      'standard_24h',
      'human_agent_7d',
      'whatsapp_template',
      'blocked',
    ])
    .catch('all'),
  stage: z
    .enum(['all', 'lead', 'engaged', 'customer', 'vip', 'inactive'])
    .catch('all'),
  tag: z.string().catch('all'),
  assigned: z.string().catch('all'),
  archived: z.enum(['active', 'archived', 'all']).catch('active'),
  sort: z.enum(['recent', 'name', 'score', 'newest', 'oldest']).catch('recent'),
})

type Stage = 'lead' | 'engaged' | 'customer' | 'vip' | 'inactive'
type TagItem = {
  id: string
  name: string
  color: string
  description: string | null
  isAutomatic: boolean
  archivedAt: string | null
  contactCount: number
  source?: string
}
type Member = { id: string; role: string; name: string }
type Contact = {
  id: string
  platform: 'instagram' | 'whatsapp' | 'manual'
  name: string
  providerName: string | null
  displayName: string | null
  username: string | null
  email: string | null
  phone: string | null
  identity: string
  avatarUrl: string | null
  company: string | null
  jobTitle: string | null
  city: string | null
  state: string | null
  countryCode: string | null
  language: string | null
  timezone: string | null
  lifecycleStage: Stage
  leadScore: number
  assignedTo: string | null
  marketingConsent: 'unknown' | 'granted' | 'revoked'
  consentUpdatedAt: string | null
  consentSource: string | null
  aiEnabled: boolean
  optedOutAt: string | null
  lastInteractionAt: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  firstSeenAt: string
  archivedAt: string | null
  customFields: Record<string, string>
  tags: TagItem[]
  eligibility: {
    policy: string
    label: string
    tone: 'green' | 'orange' | 'gray' | 'red' | 'blue'
    secondsLeft24h: number
  }
}
type ContactsResponse = {
  contacts: Contact[]
  pagination: { page: number; pageSize: number; total: number; pages: number }
  summary: { total: number; new7d: number; tags: number; eligible24h: number }
  members: Member[]
  permissions: { canManage: boolean; canRestoreOptIn: boolean }
}
type ContactDetail = {
  contact: Contact & { createdAt: string; updatedAt: string }
  notes: Array<{
    id: string
    body: string
    is_pinned: boolean
    author_user_id: string | null
    created_at: string
    can_edit: boolean
    can_delete: boolean
  }>
  audit: Array<{
    id: string
    action: string
    changes: Record<string, unknown>
    actor_user_id: string | null
    created_at: string
  }>
  conversations: Array<{
    id: string
    platform: string
    category: string
    unread_count: number
    last_message_at: string | null
    ai_enabled: boolean
  }>
  interactions: Array<{
    id: string
    platform: string
    channel: string
    direction: string
    message_text: string | null
    status: string
    policy_used: string | null
    block_reason: string | null
    created_at: string
  }>
  permissions: { canManage: boolean; canRestoreOptIn: boolean }
}

const stageLabels: Record<Stage, string> = {
  lead: 'Lead',
  engaged: 'Engajado',
  customer: 'Cliente',
  vip: 'VIP',
  inactive: 'Inativo',
}
const auditLabels: Record<string, string> = {
  contact_created: 'Contato criado',
  contact_updated: 'Perfil atualizado',
  add_tag: 'Tag adicionada',
  remove_tag: 'Tag removida',
  archive: 'Contato arquivado',
  unarchive: 'Contato restaurado',
  set_stage: 'Estágio alterado',
  assign: 'Responsável alterado',
  opt_out: 'Opt-out registrado',
  restore_opt_in: 'Novo opt-in registrado',
  ai_on: 'IA habilitada',
  ai_off: 'IA desabilitada',
  note_created: 'Nota criada',
  note_updated: 'Nota atualizada',
  note_deleted: 'Nota removida',
}

export const Route = createFileRoute('/_app/contatos')({
  validateSearch: searchSchema,
  component: ContactsPage,
})

function ContactsPage() {
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  const [data, setData] = useState<ContactsResponse | null>(null)
  const [tags, setTags] = useState<TagItem[]>([])
  const [canManageTags, setCanManageTags] = useState(false)
  const [searchDraft, setSearchDraft] = useState(filters.q)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bulkAction, setBulkAction] = useState('add_tag')
  const [bulkValue, setBulkValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  const buildUrl = useCallback(
    (page = filters.page, pageSize = 25) => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        archived: filters.archived,
        sort: filters.sort,
      })
      if (filters.q) params.set('search', filters.q)
      if (filters.platform !== 'all') params.set('platform', filters.platform)
      if (filters.eligibility !== 'all')
        params.set('eligibility', filters.eligibility)
      if (filters.stage !== 'all') params.set('stage', filters.stage)
      if (filters.tag !== 'all') params.set('tagId', filters.tag)
      if (filters.assigned !== 'all') params.set('assigned', filters.assigned)
      return `/api/contacts?${params.toString()}`
    },
    [filters],
  )

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        const [contactsResult, tagsResult] = await Promise.all([
          apiFetch<ContactsResponse>(buildUrl(), { signal }),
          apiFetch<{ tags: TagItem[]; canManage: boolean }>(
            '/api/contact-tags',
            {
              signal,
            },
          ),
        ])
        setData(contactsResult)
        setTags(tagsResult.tags)
        setCanManageTags(tagsResult.canManage)
        setSelected(new Set())
        setError(null)
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError')
          return
        setError(
          caught instanceof Error ? caught.message : 'Falha ao carregar.',
        )
      } finally {
        setLoading(false)
      }
    },
    [buildUrl],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => setSearchDraft(filters.q), [filters.q])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchDraft.trim()
      if (next === filters.q) return
      void navigate({
        search: (previous) => ({ ...previous, q: next, page: 1 }),
        replace: true,
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [filters.q, navigate, searchDraft])

  const selectedContacts = useMemo(
    () => data?.contacts.filter((contact) => selected.has(contact.id)) ?? [],
    [data, selected],
  )
  const activeFilterCount = [
    filters.platform !== 'all',
    filters.eligibility !== 'all',
    filters.stage !== 'all',
    filters.tag !== 'all',
    filters.assigned !== 'all',
    filters.archived !== 'active',
  ].filter(Boolean).length

  function updateFilters(patch: Partial<typeof filters>) {
    void navigate({
      search: (previous) => ({
        ...previous,
        ...patch,
        page: patch.page ?? 1,
      }),
      replace: true,
    })
  }

  function toggleSelection(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runBulk() {
    if (!selected.size || busy) return
    let payload: Record<string, unknown> = {
      contactIds: Array.from(selected),
      action: bulkAction,
    }
    if (bulkAction === 'add_tag' || bulkAction === 'remove_tag') {
      if (!bulkValue) return setError('Escolha uma tag para a ação em lote.')
      payload.tagId = bulkValue
    }
    if (bulkAction === 'set_stage') {
      if (!bulkValue) return setError('Escolha um estágio.')
      payload.stage = bulkValue
    }
    if (bulkAction === 'assign')
      payload.assignedTo = bulkValue === 'none' ? null : bulkValue
    if (bulkAction === 'restore_opt_in') {
      if (!bulkValue.trim())
        return setError('Informe a origem comprovável do novo opt-in.')
      payload = { ...payload, confirmed: true, source: bulkValue.trim() }
    }
    if (
      ['archive', 'opt_out', 'restore_opt_in'].includes(bulkAction) &&
      !window.confirm(
        `Confirmar “${bulkLabel(bulkAction)}” para ${selected.size} contato(s)?`,
      )
    )
      return
    setBusy(true)
    try {
      const result = await apiFetch<{ updated: number }>('/api/contacts/bulk', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setFeedback(`${result.updated} contato(s) atualizado(s).`)
      setBulkValue('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha na ação.')
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all: Contact[] = []
      const pages = Math.min(
        100,
        Math.max(1, Math.ceil((data?.pagination.total ?? 0) / 100)),
      )
      for (let page = 1; page <= pages; page += 1) {
        const result = await apiFetch<ContactsResponse>(buildUrl(page, 100))
        all.push(...result.contacts)
      }
      const rows = [
        [
          'nome',
          'canal',
          'identidade',
          'email',
          'telefone',
          'empresa',
          'cargo',
          'cidade',
          'estado',
          'estagio',
          'score',
          'tags',
          'consentimento',
          'opt_out_em',
          'ultima_interacao',
          'elegibilidade',
        ],
        ...all.map((contact) => [
          contact.name,
          contact.platform,
          contact.identity,
          contact.email ?? '',
          contact.phone ?? '',
          contact.company ?? '',
          contact.jobTitle ?? '',
          contact.city ?? '',
          contact.state ?? '',
          contact.lifecycleStage,
          contact.leadScore,
          contact.tags.map((tag) => tag.name).join('|'),
          contact.marketingConsent,
          contact.optedOutAt ?? '',
          contact.lastInteractionAt ?? '',
          contact.eligibility.policy,
        ]),
      ]
      const csv = rows
        .map((row) =>
          row
            .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
            .join(','),
        )
        .join('\n')
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `wal-chat-contatos-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
      setFeedback(`${all.length} contato(s) exportado(s).`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao exportar.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="stack-lg contacts-crm-page">
      <PageIntro
        title="Sua base, com contexto de verdade."
        description="Encontre, segmente e cuide de cada relação sem perder consentimento, canal ou histórico."
        actions={
          <>
            <button
              className="button button-outline"
              onClick={() => void exportCsv()}
              disabled={exporting || !data?.pagination.total}
            >
              {exporting ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Download size={16} />
              )}
              Exportar base
            </button>
            {canManageTags && (
              <button
                className="button button-outline"
                onClick={() => setTagsOpen(true)}
              >
                <Tags size={16} /> Gerenciar tags
              </button>
            )}
            {data?.permissions.canManage && (
              <button
                className="button button-dark"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={16} /> Novo contato
              </button>
            )}
          </>
        }
      />

      <div className="mini-stats contacts-stats" aria-label="Resumo da base">
        <Stat
          icon={<UserRoundCheck size={19} />}
          value={data?.summary.total}
          label="contatos ativos"
        />
        <Stat
          icon={<Tags size={19} />}
          value={data?.summary.tags}
          label="tags ativas"
        />
        <Stat
          icon={<span className="pulse-dot" />}
          value={data?.summary.new7d}
          label="novos em 7 dias"
        />
        <Stat
          icon={<MessageSquareText size={19} />}
          value={data?.summary.eligible24h}
          label="com janela 24h"
        />
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

      <section className="card contacts-workspace">
        <div className="contacts-toolbar">
          <label className="search-field contacts-search">
            <span className="sr-only">Buscar contatos</span>
            <Search size={17} />
            <input
              placeholder="Buscar nome, @, email ou telefone…"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            {searchDraft && (
              <button
                className="search-clear"
                aria-label="Limpar busca"
                onClick={() => setSearchDraft('')}
                type="button"
              >
                <X size={14} />
              </button>
            )}
          </label>
          <button
            className={`button button-outline ${filtersOpen ? 'active' : ''}`}
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
          >
            <Filter size={16} /> Filtros
            {activeFilterCount > 0 && (
              <span className="filter-count">{activeFilterCount}</span>
            )}
          </button>
          <label className="compact-select">
            <span>Ordenar</span>
            <select
              value={filters.sort}
              onChange={(event) =>
                updateFilters({
                  sort: event.target.value as typeof filters.sort,
                })
              }
            >
              <option value="recent">Interação recente</option>
              <option value="name">Nome A–Z</option>
              <option value="score">Maior score</option>
              <option value="newest">Mais novos</option>
              <option value="oldest">Mais antigos</option>
            </select>
          </label>
          <button
            className="icon-button"
            onClick={() => void load()}
            aria-label="Atualizar contatos"
            disabled={loading}
          >
            <RefreshCw className={loading ? 'spin' : ''} size={17} />
          </button>
        </div>

        {filtersOpen && (
          <div className="contacts-filters" aria-label="Filtros de contatos">
            <FilterSelect
              label="Canal"
              value={filters.platform}
              onChange={(value) =>
                updateFilters({ platform: value as typeof filters.platform })
              }
              options={[
                ['all', 'Todos'],
                ['instagram', 'Instagram'],
                ['whatsapp', 'WhatsApp'],
                ['manual', 'Manual'],
              ]}
            />
            <FilterSelect
              label="Elegibilidade"
              value={filters.eligibility}
              onChange={(value) =>
                updateFilters({
                  eligibility: value as typeof filters.eligibility,
                })
              }
              options={[
                ['all', 'Todas'],
                ['standard_24h', '24h aberta'],
                ['human_agent_7d', 'HUMAN_AGENT'],
                ['whatsapp_template', 'Requer template'],
                ['blocked', 'Bloqueado'],
              ]}
            />
            <FilterSelect
              label="Estágio"
              value={filters.stage}
              onChange={(value) =>
                updateFilters({ stage: value as typeof filters.stage })
              }
              options={[['all', 'Todos'], ...Object.entries(stageLabels)]}
            />
            <FilterSelect
              label="Tag"
              value={filters.tag}
              onChange={(tag) => updateFilters({ tag })}
              options={[
                ['all', 'Todas'],
                ...tags.map((tag) => [tag.id, tag.name] as [string, string]),
              ]}
            />
            <FilterSelect
              label="Responsável"
              value={filters.assigned}
              onChange={(assigned) => updateFilters({ assigned })}
              options={[
                ['all', 'Todos'],
                ['unassigned', 'Sem responsável'],
                ...(data?.members.map(
                  (member) => [member.id, member.name] as [string, string],
                ) ?? []),
              ]}
            />
            <FilterSelect
              label="Arquivo"
              value={filters.archived}
              onChange={(value) =>
                updateFilters({ archived: value as typeof filters.archived })
              }
              options={[
                ['active', 'Ativos'],
                ['archived', 'Arquivados'],
                ['all', 'Todos'],
              ]}
            />
            {activeFilterCount > 0 && (
              <button
                className="text-button filters-reset"
                onClick={() =>
                  updateFilters({
                    platform: 'all',
                    eligibility: 'all',
                    stage: 'all',
                    tag: 'all',
                    assigned: 'all',
                    archived: 'active',
                  })
                }
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}

        {selected.size > 0 && data?.permissions.canManage && (
          <div className="bulk-bar" role="region" aria-label="Ações em lote">
            <strong>{selected.size} selecionado(s)</strong>
            <select
              aria-label="Ação em lote"
              value={bulkAction}
              onChange={(event) => {
                setBulkAction(event.target.value)
                setBulkValue('')
              }}
            >
              <option value="add_tag">Adicionar tag</option>
              <option value="remove_tag">Remover tag</option>
              <option value="set_stage">Alterar estágio</option>
              <option value="assign">Definir responsável</option>
              <option value="ai_on">Ligar IA</option>
              <option value="ai_off">Desligar IA</option>
              <option value="archive">Arquivar</option>
              <option value="unarchive">Restaurar arquivo</option>
              <option value="opt_out">Registrar opt-out</option>
              {data.permissions.canRestoreOptIn && (
                <option value="restore_opt_in">Registrar novo opt-in</option>
              )}
            </select>
            {(bulkAction === 'add_tag' || bulkAction === 'remove_tag') && (
              <select
                aria-label="Tag da ação"
                value={bulkValue}
                onChange={(event) => setBulkValue(event.target.value)}
              >
                <option value="">Escolha a tag</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            )}
            {bulkAction === 'set_stage' && (
              <select
                aria-label="Novo estágio"
                value={bulkValue}
                onChange={(event) => setBulkValue(event.target.value)}
              >
                <option value="">Escolha o estágio</option>
                {Object.entries(stageLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            {bulkAction === 'assign' && (
              <select
                aria-label="Novo responsável"
                value={bulkValue}
                onChange={(event) => setBulkValue(event.target.value)}
              >
                <option value="none">Sem responsável</option>
                {data.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            )}
            {bulkAction === 'restore_opt_in' && (
              <input
                aria-label="Origem do novo opt-in"
                placeholder="Ex.: formulário de 20/08/2026"
                value={bulkValue}
                onChange={(event) => setBulkValue(event.target.value)}
              />
            )}
            <button
              className="button button-dark"
              disabled={busy}
              onClick={() => void runBulk()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Check size={15} />
              )}
              Aplicar
            </button>
            <button
              className="icon-button compact"
              aria-label="Limpar seleção"
              onClick={() => setSelected(new Set())}
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="contacts-result-line">
          <span>
            <strong>{data?.pagination.total ?? 0}</strong> resultado(s)
            {filters.q && <> para “{filters.q}”</>}
          </span>
          {selectedContacts.length > 0 && (
            <span>
              {selectedContacts
                .map((contact) => contact.name)
                .slice(0, 2)
                .join(', ')}
            </span>
          )}
        </div>

        <div className="data-table contacts-table crm-table">
          <div className="table-row table-head">
            <span>
              <input
                type="checkbox"
                aria-label="Selecionar contatos desta página"
                checked={
                  Boolean(data?.contacts.length) &&
                  selected.size === data?.contacts.length
                }
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(data?.contacts.map((contact) => contact.id))
                      : new Set(),
                  )
                }
              />
            </span>
            <span>CONTATO</span>
            <span>RELACIONAMENTO</span>
            <span>TAGS</span>
            <span>ÚLTIMA INTERAÇÃO</span>
            <span>ELEGIBILIDADE</span>
            <span />
          </div>
          {loading && !data ? (
            <TableSkeleton />
          ) : (
            data?.contacts.map((contact) => (
              <div
                className={`table-row contact-row ${selected.has(contact.id) ? 'selected' : ''}`}
                key={contact.id}
              >
                <span className="row-check">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${contact.name}`}
                    checked={selected.has(contact.id)}
                    onChange={() => toggleSelection(contact.id)}
                  />
                </span>
                <button
                  className="person-cell contact-open"
                  onClick={() => setDetailId(contact.id)}
                >
                  <Avatar
                    name={contact.name}
                    color={platformColor(contact.platform)}
                  />
                  <span>
                    <strong>{contact.name}</strong>
                    <small>
                      <ChannelBadge platform={contact.platform} />{' '}
                      {contact.identity}
                    </small>
                    {(contact.company || contact.city) && (
                      <small>
                        {[contact.company, contact.city]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    )}
                  </span>
                </button>
                <span className="relationship-cell">
                  <em className={`stage-pill ${contact.lifecycleStage}`}>
                    {stageLabels[contact.lifecycleStage]}
                  </em>
                  <small>Score {contact.leadScore}</small>
                </span>
                <span className="tag-list crm-tags">
                  {contact.tags.slice(0, 3).map((tag) => (
                    <TagChip key={tag.id} tag={tag} />
                  ))}
                  {contact.tags.length > 3 && (
                    <em>+{contact.tags.length - 3}</em>
                  )}
                  {!contact.tags.length && <small>Sem tags</small>}
                </span>
                <span className="date-cell">
                  <strong>{relativeDate(contact.lastInteractionAt)}</strong>
                  <small>{formatDate(contact.lastInteractionAt)}</small>
                </span>
                <StatusDot
                  tone={contact.optedOutAt ? 'red' : contact.eligibility.tone}
                >
                  {contact.optedOutAt ? 'Opt-out' : contact.eligibility.label}
                </StatusDot>
                <button
                  className="icon-button compact"
                  aria-label={`Abrir detalhes de ${contact.name}`}
                  onClick={() => setDetailId(contact.id)}
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
            ))
          )}
          {!loading && !data?.contacts.length && (
            <div className="table-empty contacts-empty">
              <UserRound size={28} />
              <strong>Nenhum contato por aqui.</strong>
              <span>Ajuste os filtros ou cadastre um contato manual.</span>
              {data?.permissions.canManage && (
                <button
                  className="button button-dark"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={15} /> Novo contato
                </button>
              )}
            </div>
          )}
        </div>

        {data && data.pagination.pages > 1 && (
          <div className="table-pagination" aria-label="Paginação">
            <button
              className="button button-outline"
              disabled={filters.page <= 1}
              onClick={() => updateFilters({ page: filters.page - 1 })}
            >
              <ArrowLeft size={15} /> Anterior
            </button>
            <span>
              Página <strong>{filters.page}</strong> de {data.pagination.pages}
            </span>
            <button
              className="button button-outline"
              disabled={filters.page >= data.pagination.pages}
              onClick={() => updateFilters({ page: filters.page + 1 })}
            >
              Próxima <ArrowRight size={15} />
            </button>
          </div>
        )}
      </section>

      {createOpen && (
        <CreateContactDialog
          members={data?.members ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false)
            setFeedback('Contato manual criado com segurança.')
            await load()
          }}
        />
      )}
      {tagsOpen && (
        <TagManagerDialog
          onClose={() => setTagsOpen(false)}
          onChanged={async () => {
            await load()
          }}
        />
      )}
      {detailId && (
        <ContactDrawer
          contactId={detailId}
          tags={tags}
          members={data?.members ?? []}
          onClose={() => setDetailId(null)}
          onChanged={async () => {
            await load()
          }}
        />
      )}
    </div>
  )
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: ReactNode
  value?: number
  label: string
}) {
  return (
    <div>
      {icon}
      <span>
        <strong>{value ?? '—'}</strong>
        <small>{label}</small>
      </span>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function ChannelBadge({ platform }: { platform: Contact['platform'] }) {
  return (
    <em className={`channel-badge ${platform}`}>
      {platform === 'instagram' ? 'IG' : platform === 'whatsapp' ? 'WA' : 'CRM'}
    </em>
  )
}

function TagChip({ tag }: { tag: Pick<TagItem, 'name' | 'color'> }) {
  return (
    <em
      className="crm-tag"
      style={{ '--tag-color': tag.color } as CSSProperties}
    >
      <i /> {tag.name}
    </em>
  )
}

function TableSkeleton() {
  return (
    <div className="contacts-skeleton" aria-label="Carregando contatos">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index}>
          <i />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  )
}

function DialogShell({
  title,
  description,
  wide = false,
  onClose,
  children,
}: {
  title: string
  description?: string
  wide?: boolean
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onClose])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`crm-modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-dialog-title"
      >
        <header>
          <div>
            <h2 id="crm-dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            autoFocus
            aria-label="Fechar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function CreateContactDialog({
  members,
  onClose,
  onCreated,
}: {
  members: Member[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    phone: '',
    company: '',
    jobTitle: '',
    city: '',
    state: '',
    countryCode: 'BR',
    lifecycleStage: 'lead',
    leadScore: '0',
    assignedTo: '',
    marketingConsent: 'unknown',
    consentSource: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  function field(name: keyof typeof form) {
    return {
      value: form[name],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((current) => ({ ...current, [name]: event.target.value })),
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await apiFetch('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          email: form.email || null,
          phone: form.phone || null,
          company: form.company || null,
          jobTitle: form.jobTitle || null,
          city: form.city || null,
          state: form.state || null,
          countryCode: form.countryCode || null,
          leadScore: Number(form.leadScore),
          assignedTo: form.assignedTo || null,
          consentSource: form.consentSource || null,
          customFields: {},
        }),
      })
      await onCreated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao criar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <DialogShell
      title="Novo contato manual"
      description="Cadastre relacionamento e consentimento. Contatos manuais nunca recebem disparos Meta."
      wide
      onClose={onClose}
    >
      <form className="crm-form" onSubmit={(event) => void submit(event)}>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-grid two">
          <Field label="Nome *">
            <input required maxLength={120} {...field('displayName')} />
          </Field>
          <Field label="Empresa">
            <input maxLength={120} {...field('company')} />
          </Field>
          <Field label="Email">
            <input type="email" maxLength={254} {...field('email')} />
          </Field>
          <Field label="Telefone">
            <input type="tel" maxLength={30} {...field('phone')} />
          </Field>
          <Field label="Cargo">
            <input maxLength={120} {...field('jobTitle')} />
          </Field>
          <Field label="Cidade">
            <input maxLength={100} {...field('city')} />
          </Field>
          <Field label="Estado">
            <input maxLength={100} {...field('state')} />
          </Field>
          <Field label="País (ISO)">
            <input maxLength={2} {...field('countryCode')} />
          </Field>
          <Field label="Estágio">
            <select {...field('lifecycleStage')}>
              {Object.entries(stageLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Score">
            <input type="number" min="0" max="100" {...field('leadScore')} />
          </Field>
          <Field label="Responsável">
            <select {...field('assignedTo')}>
              <option value="">Sem responsável</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Consentimento">
            <select {...field('marketingConsent')}>
              <option value="unknown">Não informado</option>
              <option value="granted">Concedido</option>
              <option value="revoked">Revogado</option>
            </select>
          </Field>
        </div>
        {form.marketingConsent !== 'unknown' && (
          <Field
            label="Origem do consentimento"
            helper="Registre como e quando a autorização foi obtida."
          >
            <input
              required
              maxLength={120}
              placeholder="Ex.: formulário do site em 20/08/2026"
              {...field('consentSource')}
            />
          </Field>
        )}
        <p className="form-helper">Informe ao menos email ou telefone.</p>
        <footer className="modal-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button button-dark" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}{' '}
            Criar contato
          </button>
        </footer>
      </form>
    </DialogShell>
  )
}

function TagManagerDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [items, setItems] = useState<TagItem[]>([])
  const [editing, setEditing] = useState<TagItem | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#f05a28')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadTags = useCallback(async () => {
    try {
      const result = await apiFetch<{ tags: TagItem[] }>(
        '/api/contact-tags?archived=true',
      )
      setItems(result.tags)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao carregar tags.',
      )
    }
  }, [])
  useEffect(() => {
    void loadTags()
  }, [loadTags])
  function reset() {
    setEditing(null)
    setName('')
    setColor('#f05a28')
    setDescription('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await apiFetch('/api/contact-tags', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(editing ? { id: editing.id } : {}),
          name,
          color,
          description: description || null,
        }),
      })
      reset()
      await loadTags()
      await onChanged()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao salvar tag.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function toggleArchive(tag: TagItem) {
    if (
      !tag.archivedAt &&
      !window.confirm(
        `Arquivar a tag “${tag.name}”? Os vínculos serão preservados.`,
      )
    )
      return
    setBusy(true)
    try {
      if (tag.archivedAt)
        await apiFetch('/api/contact-tags', {
          method: 'PATCH',
          body: JSON.stringify({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            description: tag.description,
            archived: false,
          }),
        })
      else
        await apiFetch('/api/contact-tags', {
          method: 'DELETE',
          body: JSON.stringify({ id: tag.id }),
        })
      await loadTags()
      await onChanged()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao arquivar tag.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <DialogShell
      title="Tags do workspace"
      description="Crie segmentos claros e preserve a origem automática das tags."
      wide
      onClose={onClose}
    >
      <div className="tag-manager-layout">
        <form
          className="crm-form tag-editor"
          onSubmit={(event) => void save(event)}
        >
          <h3>{editing ? 'Editar tag' : 'Nova tag'}</h3>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <Field label="Nome *">
            <input
              required
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Cor">
            <input
              className="color-input"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </Field>
          <Field label="Descrição">
            <textarea
              maxLength={240}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            {editing && (
              <button
                type="button"
                className="button button-outline"
                onClick={reset}
              >
                Cancelar edição
              </button>
            )}
            <button className="button button-dark" disabled={busy}>
              <Save size={15} /> Salvar tag
            </button>
          </div>
        </form>
        <div className="tag-catalog">
          {items.map((tag) => (
            <article key={tag.id} className={tag.archivedAt ? 'archived' : ''}>
              <div>
                <TagChip tag={tag} />
                {tag.isAutomatic && <small>AUTOMÁTICA</small>}
              </div>
              <p>{tag.description || 'Sem descrição.'}</p>
              <span>{tag.contactCount} contato(s)</span>
              <div>
                <button
                  className="icon-button compact"
                  aria-label={`Editar ${tag.name}`}
                  onClick={() => {
                    setEditing(tag)
                    setName(tag.name)
                    setColor(tag.color)
                    setDescription(tag.description ?? '')
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button compact"
                  aria-label={
                    tag.archivedAt
                      ? `Restaurar ${tag.name}`
                      : `Arquivar ${tag.name}`
                  }
                  onClick={() => void toggleArchive(tag)}
                >
                  {tag.archivedAt ? (
                    <ArchiveRestore size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                </button>
              </div>
            </article>
          ))}
          {!items.length && (
            <div className="table-empty">Nenhuma tag criada.</div>
          )}
        </div>
      </div>
    </DialogShell>
  )
}

function ContactDrawer({
  contactId,
  tags,
  members,
  onClose,
  onChanged,
}: {
  contactId: string
  tags: TagItem[]
  members: Member[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [tab, setTab] = useState<'profile' | 'notes' | 'history'>('profile')
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const [pinNewNote, setPinNewNote] = useState(false)
  const [optInSource, setOptInSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadDetail = useCallback(async () => {
    try {
      setDetail(await apiFetch<ContactDetail>(`/api/contacts/${contactId}`))
      setError(null)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao carregar perfil.',
      )
    }
  }, [contactId])
  useEffect(() => {
    void loadDetail()
  }, [loadDetail])
  useEffect(() => {
    const listener = (event: KeyboardEvent) =>
      event.key === 'Escape' && onClose()
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onClose])
  async function bulk(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    try {
      await apiFetch('/api/contacts/bulk', {
        method: 'PATCH',
        body: JSON.stringify({ contactIds: [contactId], action, ...extra }),
      })
      await loadDetail()
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao atualizar.')
    } finally {
      setBusy(false)
    }
  }
  async function addNote(event: FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    setBusy(true)
    try {
      await apiFetch(`/api/contacts/${contactId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: note, isPinned: pinNewNote }),
      })
      setNote('')
      setPinNewNote(false)
      await loadDetail()
      await onChanged()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao criar nota.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function updateNote(
    noteId: string,
    action: 'pin' | 'unpin' | 'delete',
  ) {
    if (
      action === 'delete' &&
      !window.confirm('Excluir esta nota interna? Esta ação será auditada.')
    )
      return
    setBusy(true)
    try {
      await apiFetch(`/api/contacts/${contactId}/notes`, {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        body: JSON.stringify(
          action === 'delete'
            ? { noteId }
            : { noteId, isPinned: action === 'pin' },
        ),
      })
      await loadDetail()
      await onChanged()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao alterar a nota.',
      )
    } finally {
      setBusy(false)
    }
  }
  const contact = detail?.contact
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="contact-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-drawer-title"
      >
        <header>
          <button
            className="icon-button"
            aria-label="Fechar perfil"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {!contact ? (
          <div className="drawer-loading">
            {error ? (
              <div className="form-error">{error}</div>
            ) : (
              <>
                <LoaderCircle className="spin" /> Carregando perfil…
              </>
            )}
          </div>
        ) : (
          <>
            <div className="contact-hero">
              <Avatar
                name={contact.name}
                color={platformColor(contact.platform)}
              />
              <div>
                <ChannelBadge platform={contact.platform} />
                <h2 id="contact-drawer-title">{contact.name}</h2>
                <p>{contact.identity}</p>
              </div>
              <StatusDot
                tone={contact.optedOutAt ? 'red' : contact.eligibility.tone}
              >
                {contact.optedOutAt ? 'Opt-out' : contact.eligibility.label}
              </StatusDot>
            </div>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <nav className="drawer-tabs" aria-label="Seções do contato">
              {(
                [
                  ['profile', 'Perfil'],
                  ['notes', `Notas (${detail.notes.length})`],
                  ['history', 'Histórico'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={tab === value ? 'active' : ''}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="drawer-content">
              {tab === 'profile' &&
                (editing ? (
                  <ContactEditForm
                    contact={contact}
                    members={members}
                    onCancel={() => setEditing(false)}
                    onSaved={async () => {
                      setEditing(false)
                      await loadDetail()
                      await onChanged()
                    }}
                  />
                ) : (
                  <>
                    <div className="profile-actions">
                      {detail.permissions.canManage && (
                        <button
                          className="button button-outline"
                          onClick={() => setEditing(true)}
                        >
                          <Pencil size={15} /> Editar perfil
                        </button>
                      )}
                      {contact.platform !== 'manual' && (
                        <Link to="/inbox" className="button button-dark">
                          <MessageSquareText size={15} /> Abrir Inbox
                        </Link>
                      )}
                    </div>
                    <section className="contact-score">
                      <span>
                        <SlidersHorizontal size={17} /> Score do relacionamento
                      </span>
                      <strong>{contact.leadScore}</strong>
                      <div>
                        <i style={{ width: `${contact.leadScore}%` }} />
                      </div>
                    </section>
                    <InfoGrid contact={contact} members={members} />
                    <section className="drawer-section">
                      <header>
                        <h3>
                          <Tags size={16} /> Tags
                        </h3>
                        <span>{contact.tags.length}</span>
                      </header>
                      <div className="tag-checkbox-grid">
                        {tags.map((tag) => {
                          const checked = contact.tags.some(
                            (item) => item.id === tag.id,
                          )
                          return (
                            <label key={tag.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={busy || !detail.permissions.canManage}
                                onChange={() =>
                                  void bulk(
                                    checked ? 'remove_tag' : 'add_tag',
                                    { tagId: tag.id },
                                  )
                                }
                              />
                              <TagChip tag={tag} />
                            </label>
                          )
                        })}
                      </div>
                    </section>
                    <section className="drawer-section compliance-controls">
                      <header>
                        <h3>
                          <CircleAlert size={16} /> Consentimento e automação
                        </h3>
                      </header>
                      <p>
                        Consentimento:{' '}
                        <strong>
                          {consentLabel(contact.marketingConsent)}
                        </strong>
                        {contact.consentSource && (
                          <> · {contact.consentSource}</>
                        )}
                      </p>
                      <p>
                        IA:{' '}
                        <strong>
                          {contact.aiEnabled ? 'ligada' : 'desligada'}
                        </strong>
                      </p>
                      {detail.permissions.canManage && !contact.optedOutAt && (
                        <div>
                          <button
                            className="button button-outline danger"
                            onClick={() =>
                              window.confirm(
                                'Registrar opt-out e bloquear automações deste contato?',
                              ) && void bulk('opt_out')
                            }
                          >
                            Registrar opt-out
                          </button>
                          {contact.platform !== 'manual' && (
                            <button
                              className="button button-outline"
                              onClick={() =>
                                void bulk(
                                  contact.aiEnabled ? 'ai_off' : 'ai_on',
                                )
                              }
                            >
                              {contact.aiEnabled ? 'Desligar IA' : 'Ligar IA'}
                            </button>
                          )}
                        </div>
                      )}
                      {contact.optedOutAt &&
                        detail.permissions.canRestoreOptIn && (
                          <div className="restore-optin">
                            <label>
                              <span>Prova/origem do novo opt-in</span>
                              <input
                                value={optInSource}
                                onChange={(e) => setOptInSource(e.target.value)}
                                placeholder="Ex.: formulário assinado em 20/08/2026"
                              />
                            </label>
                            <button
                              className="button button-dark"
                              disabled={!optInSource.trim() || busy}
                              onClick={() =>
                                void bulk('restore_opt_in', {
                                  confirmed: true,
                                  source: optInSource.trim(),
                                })
                              }
                            >
                              Registrar novo opt-in
                            </button>
                          </div>
                        )}
                    </section>
                    {detail.permissions.canManage && (
                      <section className="drawer-danger-zone">
                        <button
                          className="button button-outline"
                          onClick={() =>
                            void bulk(
                              contact.archivedAt ? 'unarchive' : 'archive',
                            )
                          }
                        >
                          {contact.archivedAt ? (
                            <ArchiveRestore size={15} />
                          ) : (
                            <Archive size={15} />
                          )}
                          {contact.archivedAt
                            ? 'Restaurar contato'
                            : 'Arquivar contato'}
                        </button>
                      </section>
                    )}
                  </>
                ))}
              {tab === 'notes' && (
                <section className="notes-panel">
                  {detail.permissions.canManage && (
                    <form onSubmit={(event) => void addNote(event)}>
                      <label>
                        <span>Nova nota interna</span>
                        <textarea
                          rows={4}
                          maxLength={4000}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Contexto importante para a equipe…"
                        />
                      </label>
                      <button
                        className="button button-dark"
                        disabled={busy || !note.trim()}
                      >
                        <NotebookPen size={15} /> Salvar nota
                      </button>
                      <label className="note-pin-option">
                        <input
                          type="checkbox"
                          checked={pinNewNote}
                          onChange={(event) =>
                            setPinNewNote(event.target.checked)
                          }
                        />
                        Fixar no topo
                      </label>
                    </form>
                  )}
                  <div className="note-list">
                    {detail.notes.map((item) => (
                      <article key={item.id}>
                        <div className="note-actions">
                          {item.can_edit && (
                            <button
                              className="icon-button"
                              aria-label={
                                item.is_pinned ? 'Desafixar nota' : 'Fixar nota'
                              }
                              title={
                                item.is_pinned ? 'Desafixar nota' : 'Fixar nota'
                              }
                              disabled={busy}
                              onClick={() =>
                                void updateNote(
                                  item.id,
                                  item.is_pinned ? 'unpin' : 'pin',
                                )
                              }
                            >
                              <Pin size={14} />
                            </button>
                          )}
                          {item.can_delete && (
                            <button
                              className="icon-button danger"
                              aria-label="Excluir nota"
                              title="Excluir nota"
                              disabled={busy}
                              onClick={() => void updateNote(item.id, 'delete')}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        {item.is_pinned && (
                          <span className="note-pinned-label">
                            <Pin size={12} /> Fixada
                          </span>
                        )}
                        <p>{item.body}</p>
                        <small>{formatDate(item.created_at)}</small>
                      </article>
                    ))}
                    {!detail.notes.length && (
                      <div className="table-empty">
                        Ainda não há notas internas.
                      </div>
                    )}
                  </div>
                </section>
              )}
              {tab === 'history' && (
                <div className="contact-timeline">
                  {[
                    ...detail.interactions.map((item) => ({
                      id: item.id,
                      at: item.created_at,
                      title: `${item.direction === 'inbound' ? 'Recebido' : 'Enviado'} · ${item.channel}`,
                      text:
                        item.message_text || item.block_reason || item.status,
                      kind: 'interaction',
                    })),
                    ...detail.audit.map((item) => ({
                      id: item.id,
                      at: item.created_at,
                      title: auditLabels[item.action] ?? item.action,
                      text: '',
                      kind: 'audit',
                    })),
                  ]
                    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
                    .map((item) => (
                      <article key={`${item.kind}-${item.id}`}>
                        <i />
                        <div>
                          <strong>{item.title}</strong>
                          {item.text && <p>{item.text}</p>}
                          <small>{formatDate(item.at)}</small>
                        </div>
                      </article>
                    ))}
                  {!detail.interactions.length && !detail.audit.length && (
                    <div className="table-empty">
                      Nenhuma atividade registrada.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

function ContactEditForm({
  contact,
  members,
  onCancel,
  onSaved,
}: {
  contact: Contact
  members: Member[]
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({
    displayName: contact.displayName ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    company: contact.company ?? '',
    jobTitle: contact.jobTitle ?? '',
    city: contact.city ?? '',
    state: contact.state ?? '',
    countryCode: contact.countryCode ?? '',
    language: contact.language ?? '',
    timezone: contact.timezone ?? '',
    lifecycleStage: contact.lifecycleStage,
    leadScore: String(contact.leadScore),
    assignedTo: contact.assignedTo ?? '',
  })
  const [customFields, setCustomFields] = useState(
    Object.entries(contact.customFields).map(([key, value]) => ({
      key,
      value,
    })),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  function field(name: keyof typeof form) {
    return {
      value: form[name],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((current) => ({ ...current, [name]: event.target.value })),
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await apiFetch(`/api/contacts/${contact.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...form,
          displayName: form.displayName || null,
          email: form.email || null,
          phone: form.phone || null,
          company: form.company || null,
          jobTitle: form.jobTitle || null,
          city: form.city || null,
          state: form.state || null,
          countryCode: form.countryCode || null,
          language: form.language || null,
          timezone: form.timezone || null,
          leadScore: Number(form.leadScore),
          assignedTo: form.assignedTo || null,
          customFields: Object.fromEntries(
            customFields
              .map((item) => [item.key.trim(), item.value.trim()] as const)
              .filter(([key]) => key),
          ),
        }),
      })
      await onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="crm-form drawer-edit-form"
      onSubmit={(event) => void submit(event)}
    >
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid two">
        <Field label="Nome no CRM">
          <input {...field('displayName')} />
        </Field>
        <Field label="Empresa">
          <input {...field('company')} />
        </Field>
        <Field label="Email">
          <input type="email" {...field('email')} />
        </Field>
        <Field label="Telefone">
          <input type="tel" {...field('phone')} />
        </Field>
        <Field label="Cargo">
          <input {...field('jobTitle')} />
        </Field>
        <Field label="Cidade">
          <input {...field('city')} />
        </Field>
        <Field label="Estado">
          <input {...field('state')} />
        </Field>
        <Field label="País">
          <input maxLength={2} {...field('countryCode')} />
        </Field>
        <Field label="Idioma">
          <input {...field('language')} />
        </Field>
        <Field label="Fuso horário">
          <input placeholder="America/Sao_Paulo" {...field('timezone')} />
        </Field>
        <Field label="Estágio">
          <select {...field('lifecycleStage')}>
            {Object.entries(stageLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Score">
          <input type="number" min="0" max="100" {...field('leadScore')} />
        </Field>
        <Field label="Responsável">
          <select {...field('assignedTo')}>
            <option value="">Sem responsável</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <section className="custom-fields-editor">
        <header>
          <div>
            <strong>Campos personalizados</strong>
            <small>Informações específicas do seu processo comercial.</small>
          </div>
          <button
            type="button"
            className="button button-outline"
            onClick={() =>
              setCustomFields((current) => [...current, { key: '', value: '' }])
            }
          >
            <Plus size={14} /> Adicionar campo
          </button>
        </header>
        {customFields.map((item, index) => (
          <div className="custom-field-row" key={`${index}-${item.key}`}>
            <input
              aria-label={`Nome do campo personalizado ${index + 1}`}
              maxLength={50}
              placeholder="Ex.: Produto de interesse"
              value={item.key}
              onChange={(event) =>
                setCustomFields((current) =>
                  current.map((customField, fieldIndex) =>
                    fieldIndex === index
                      ? { ...customField, key: event.target.value }
                      : customField,
                  ),
                )
              }
            />
            <input
              aria-label={`Valor do campo personalizado ${index + 1}`}
              maxLength={500}
              placeholder="Valor"
              value={item.value}
              onChange={(event) =>
                setCustomFields((current) =>
                  current.map((customField, fieldIndex) =>
                    fieldIndex === index
                      ? { ...customField, value: event.target.value }
                      : customField,
                  ),
                )
              }
            />
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Remover campo personalizado ${index + 1}`}
              onClick={() =>
                setCustomFields((current) =>
                  current.filter((_, fieldIndex) => fieldIndex !== index),
                )
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {!customFields.length && (
          <p className="custom-fields-empty">Nenhum campo adicional.</p>
        )}
      </section>
      <footer className="modal-actions">
        <button
          type="button"
          className="button button-outline"
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button className="button button-dark" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Save size={15} />
          )}{' '}
          Salvar alterações
        </button>
      </footer>
    </form>
  )
}

function InfoGrid({
  contact,
  members,
}: {
  contact: Contact
  members: Member[]
}) {
  const responsible =
    members.find((member) => member.id === contact.assignedTo)?.name ??
    'Sem responsável'
  return (
    <div className="contact-info-grid">
      <Info
        icon={<Mail size={15} />}
        label="Email"
        value={contact.email ?? 'Não informado'}
      />
      <Info
        icon={<Phone size={15} />}
        label="Telefone"
        value={contact.phone ?? 'Não informado'}
      />
      <Info
        icon={<Building2 size={15} />}
        label="Empresa"
        value={
          [contact.company, contact.jobTitle].filter(Boolean).join(' · ') ||
          'Não informado'
        }
      />
      <Info
        icon={<UserRoundCheck size={15} />}
        label="Responsável"
        value={responsible}
      />
      <Info
        icon={<Tag size={15} />}
        label="Estágio"
        value={stageLabels[contact.lifecycleStage]}
      />
      <Info
        icon={<Bot size={15} />}
        label="Primeiro contato"
        value={formatDate(contact.firstSeenAt)}
      />
      {Object.entries(contact.customFields).map(([key, value]) => (
        <Info
          key={key}
          icon={<SlidersHorizontal size={15} />}
          label={key}
          value={value}
        />
      ))}
    </div>
  )
}
function Info({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div>
      {icon}
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  )
}
function Field({
  label,
  helper,
  children,
}: {
  label: string
  helper?: string
  children: ReactNode
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {helper && <small>{helper}</small>}
    </label>
  )
}
function platformColor(platform: Contact['platform']) {
  return platform === 'whatsapp'
    ? '#1d7a55'
    : platform === 'instagram'
      ? '#f05a28'
      : '#2f68d5'
}
function formatDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'Sem registro'
}
function relativeDate(value: string | null) {
  if (!value) return 'Sem interação'
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60_000),
  )
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`
  return `${Math.floor(minutes / 1440)} d`
}
function bulkLabel(action: string) {
  return (
    (
      {
        archive: 'arquivar',
        opt_out: 'registrar opt-out',
        restore_opt_in: 'registrar novo opt-in',
      } as Record<string, string>
    )[action] ?? action
  )
}
function consentLabel(value: Contact['marketingConsent']) {
  return value === 'granted'
    ? 'Concedido'
    : value === 'revoked'
      ? 'Revogado'
      : 'Não informado'
}
