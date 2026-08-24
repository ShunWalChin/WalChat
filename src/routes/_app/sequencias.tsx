/** Automation Studio: editor visual do mesmo DAG versionado executado pelo scheduler. */
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  Bot,
  Boxes,
  Braces,
  ChevronRight,
  CircleStop,
  Clock3,
  GitBranch,
  Hand,
  LoaderCircle,
  MessageSquareText,
  Network,
  Play,
  Plus,
  Rocket,
  Save,
  Search,
  Send,
  Sparkles,
  Split,
  Tag,
  Trash2,
  Undo2,
  Webhook,
  Workflow,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageIntro } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import type {
  AutomationAction,
  AutomationGraph,
  AutomationNode,
} from '../../server/automation-graph'
import {
  AutomationGraphError,
  validateAutomationGraph,
} from '../../server/automation-graph'

export const Route = createFileRoute('/_app/sequencias')({
  component: AutomationStudio,
})

type FlowSummary = {
  id: string
  name: string
  description: string | null
  status: 'draft' | 'published' | 'archived'
  current_version: number
  revision: number
  updated_at: string
  metrics: { total: number; active: number; failed: number; completed: number }
}
type FlowDetail = {
  flow: FlowSummary & { draft_graph: AutomationGraph }
  versions: Array<{ id: string; version: number; published_at: string }>
  executions: Array<{
    id: string
    contact_id: string
    status: string
    current_node_id: string | null
    steps_count: number
    last_error_code: string | null
    started_at: string
  }>
}
type Catalogs = {
  agents: Array<{ id: string; name: string; isActive: boolean }>
  tags: Array<{ id: string; name: string; color: string }>
  customFields: Array<{ field_key: string; label: string; field_type: string }>
  botFields: Array<{ field_key: string; label: string; field_type: string }>
  bookingPages: Array<{ id: string; title: string; isActive: boolean }>
  contacts: Array<{
    id: string
    name: string
    identity: string
    platform: string
  }>
  n8nConnected: boolean
}
type StudioData = {
  flows: FlowSummary[]
  permissions: { canManage: boolean; canExecute: boolean }
}
type Feedback = { tone: 'success' | 'error' | 'info'; text: string }
type NodeType = AutomationNode['type']

const NODE_META: Record<
  NodeType,
  { label: string; description: string; color: string; icon: typeof Workflow }
> = {
  start: {
    label: 'Entrada',
    description: 'Gatilho conectado',
    color: '#326bd6',
    icon: Play,
  },
  message: {
    label: 'Mensagem',
    description: 'Texto, mídia e agenda',
    color: '#f05a28',
    icon: MessageSquareText,
  },
  ai_reply: {
    label: 'Agente de IA',
    description: 'Resposta com conhecimento',
    color: '#7557c7',
    icon: Bot,
  },
  delay: {
    label: 'Espera',
    description: 'Minutos, horas ou dias',
    color: '#2772a8',
    icon: Clock3,
  },
  condition: {
    label: 'Condição',
    description: 'Rota verdadeira ou falsa',
    color: '#b26b19',
    icon: GitBranch,
  },
  random_split: {
    label: 'Teste A/B',
    description: 'Divisão determinística',
    color: '#a14984',
    icon: Split,
  },
  action: {
    label: 'Ação de CRM',
    description: 'Tags e campos tipados',
    color: '#238561',
    icon: Tag,
  },
  handoff: {
    label: 'Handoff humano',
    description: 'Fila, prioridade e nota',
    color: '#a33a2d',
    icon: Hand,
  },
  n8n_event: {
    label: 'Evento n8n',
    description: 'Webhook HMAC confirmado',
    color: '#7847a8',
    icon: Webhook,
  },
  subflow: {
    label: 'Subfluxo',
    description: 'Orquestra outra jornada',
    color: '#176f78',
    icon: Network,
  },
  end: {
    label: 'Encerrar',
    description: 'Resultado da jornada',
    color: '#545454',
    icon: CircleStop,
  },
}
const PALETTE: NodeType[] = [
  'message',
  'ai_reply',
  'delay',
  'condition',
  'random_split',
  'action',
  'handoff',
  'n8n_event',
  'subflow',
]

function AutomationStudio() {
  const [studio, setStudio] = useState<StudioData | null>(null)
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null)
  const [detail, setDetail] = useState<FlowDetail | null>(null)
  const [draft, setDraft] = useState<AutomationGraph | null>(null)
  const [flowName, setFlowName] = useState('')
  const [flowDescription, setFlowDescription] = useState('')
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState('start')
  const [contactId, setContactId] = useState('')
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(0.88)
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [history, setHistory] = useState<AutomationGraph[]>([])

  const loadCatalogs = useCallback(async () => {
    const [agents, tags, fields, pages, contacts, n8n] = await Promise.all([
      apiFetch<{ agents: Catalogs['agents'] }>('/api/ai/agents'),
      apiFetch<{ tags: Catalogs['tags'] }>('/api/contact-tags'),
      apiFetch<{
        customFields: Catalogs['customFields']
        botFields: Catalogs['botFields']
      }>('/api/automations/fields'),
      apiFetch<{ pages: Catalogs['bookingPages'] }>(
        '/api/calendar/booking-pages',
      ),
      apiFetch<{ contacts: Catalogs['contacts'] }>(
        '/api/contacts?pageSize=100&sort=recent',
      ),
      apiFetch<{ connection: { status: string } | null }>(
        '/api/integrations/n8n/status',
      ),
    ])
    const eligibleContacts = contacts.contacts.filter((contact) =>
      ['instagram', 'whatsapp'].includes(contact.platform),
    )
    setCatalogs({
      agents: agents.agents.filter((agent) => agent.isActive),
      tags: tags.tags,
      customFields: fields.customFields,
      botFields: fields.botFields,
      bookingPages: pages.pages.filter((page) => page.isActive),
      contacts: eligibleContacts,
      n8nConnected: n8n.connection?.status === 'connected',
    })
    setContactId((current) => current || eligibleContacts[0]?.id || '')
  }, [])

  const loadDetail = useCallback(async (flowId: string) => {
    const result = await apiFetch<FlowDetail>(`/api/automations/${flowId}`)
    setDetail(result)
    setDraft(structuredClone(result.flow.draft_graph))
    setFlowName(result.flow.name)
    setFlowDescription(result.flow.description ?? '')
    setSelectedNodeId(result.flow.draft_graph.entryNodeId)
    setHistory([])
  }, [])

  const load = useCallback(
    async (preferredId?: string) => {
      setBusy('load')
      try {
        const result = await apiFetch<StudioData>('/api/automations')
        setStudio(result)
        await loadCatalogs()
        const nextId =
          preferredId ??
          selectedFlowId ??
          result.flows.find((flow) => flow.status !== 'archived')?.id ??
          null
        setSelectedFlowId(nextId)
        if (nextId) await loadDetail(nextId)
        else {
          setDetail(null)
          setDraft(null)
        }
      } catch (error) {
        setFeedback({ tone: 'error', text: errorMessage(error) })
      } finally {
        setBusy(null)
      }
    },
    [loadCatalogs, loadDetail, selectedFlowId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const hasChanges = useMemo(() => {
    if (!detail || !draft) return false
    return (
      flowName !== detail.flow.name ||
      flowDescription !== (detail.flow.description ?? '') ||
      JSON.stringify(draft) !== JSON.stringify(detail.flow.draft_graph)
    )
  }, [detail, draft, flowDescription, flowName])
  const selectedNode = draft?.nodes.find((node) => node.id === selectedNodeId)
  const layout = useMemo(() => (draft ? layoutGraph(draft) : null), [draft])

  function commitGraph(next: AutomationGraph) {
    if (draft) setHistory((items) => [...items.slice(-29), draft])
    setDraft(next)
    setFeedback(null)
  }

  async function createFlow() {
    const name = window.prompt('Nome da nova automação:', 'Nova jornada')
    if (!name?.trim()) return
    setBusy('create')
    try {
      const result = await apiFetch<{ id: string }>('/api/automations', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: '',
          graph: starterGraph(),
        }),
      })
      setSelectedFlowId(result.id)
      await load(result.id)
      setFeedback({
        tone: 'success',
        text: 'Jornada criada. Configure, valide e publique quando estiver pronta.',
      })
    } catch (error) {
      setFeedback({ tone: 'error', text: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  async function selectFlow(flowId: string) {
    if (hasChanges && !window.confirm('Descartar alterações não salvas?'))
      return
    setBusy('load-flow')
    setSelectedFlowId(flowId)
    try {
      await loadDetail(flowId)
      setFeedback(null)
    } catch (error) {
      setFeedback({ tone: 'error', text: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  async function saveDraft() {
    if (!detail || !draft) throw new Error('Nenhuma jornada selecionada.')
    validateAutomationGraph(draft)
    setBusy('save')
    try {
      const saved = await apiFetch<{ revision: number }>(
        `/api/automations/${detail.flow.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            expectedRevision: detail.flow.revision,
            name: flowName,
            description: flowDescription || null,
            graph: draft,
          }),
        },
      )
      await loadDetail(detail.flow.id)
      setFeedback({ tone: 'success', text: 'Rascunho salvo no backend.' })
      return saved.revision
    } catch (error) {
      setFeedback({ tone: 'error', text: friendlyGraphError(error) })
      throw error
    } finally {
      setBusy(null)
    }
  }

  function validateDraft() {
    if (!draft) return
    try {
      const valid = validateAutomationGraph(draft)
      const sends = valid.nodes.filter((node) =>
        ['message', 'ai_reply'].includes(node.type),
      ).length
      setFeedback({
        tone: 'success',
        text: `Fluxo íntegro: ${valid.nodes.length} blocos, ${valid.edges.length} conexões e ${sends} pontos de envio. Referências externas serão revalidadas ao publicar.`,
      })
    } catch (error) {
      setFeedback({ tone: 'error', text: friendlyGraphError(error) })
    }
  }

  async function publishFlow() {
    if (
      !detail ||
      !draft ||
      !window.confirm('Publicar uma versão imutável desta jornada?')
    )
      return
    setBusy('publish')
    try {
      let revision = detail.flow.revision
      if (hasChanges) revision = await saveDraft()
      const result = await apiFetch<{
        published: { version_number: number } | null
      }>(`/api/automations/${detail.flow.id}`, {
        method: 'POST',
        body: JSON.stringify({ expectedRevision: revision }),
      })
      await load(detail.flow.id)
      setFeedback({
        tone: 'success',
        text: `Versão ${result.published?.version_number ?? 'nova'} publicada. Novas execuções usarão somente este snapshot.`,
      })
    } catch (error) {
      setFeedback({ tone: 'error', text: friendlyGraphError(error) })
    } finally {
      setBusy(null)
    }
  }

  async function executeFlow() {
    if (
      !detail ||
      !contactId ||
      !window.confirm(
        'Iniciar esta jornada para o contato escolhido? Qualquer envio continuará sujeito ao Go-Live, janela de 24h, opt-out e cooldown.',
      )
    )
      return
    setBusy('execute')
    try {
      const result = await apiFetch<{ executionId: string }>(
        `/api/automations/${detail.flow.id}/execute`,
        {
          method: 'POST',
          body: JSON.stringify({
            contactId,
            requestKey: `studio_${crypto.randomUUID().replaceAll('-', '')}`,
          }),
        },
      )
      setFeedback({
        tone: 'success',
        text: `Execução ${result.executionId.slice(0, 8)} agendada. Acompanhe a trilha abaixo.`,
      })
      await loadDetail(detail.flow.id)
    } catch (error) {
      setFeedback({ tone: 'error', text: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  async function archiveFlow() {
    if (!detail || !window.confirm(`Arquivar “${detail.flow.name}”?`)) return
    setBusy('archive')
    try {
      await apiFetch(`/api/automations/${detail.flow.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedRevision: detail.flow.revision }),
      })
      setSelectedFlowId(null)
      await load()
      setFeedback({ tone: 'success', text: 'Automação arquivada.' })
    } catch (error) {
      setFeedback({ tone: 'error', text: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  function addNode(type: NodeType) {
    if (!draft || !catalogs) return
    try {
      const node = createNode(
        type,
        catalogs,
        (studio?.flows ?? []).filter(
          (flow) => flow.status === 'published' && flow.id !== detail?.flow.id,
        ),
      )
      commitGraph(insertAfterSelection(draft, selectedNodeId, node))
      setSelectedNodeId(node.id)
    } catch (error) {
      setFeedback({ tone: 'error', text: errorMessage(error) })
    }
  }
  function updateNode(node: AutomationNode) {
    if (draft)
      commitGraph({
        ...draft,
        nodes: draft.nodes.map((item) => (item.id === node.id ? node : item)),
      })
  }
  function updateEdge(branch: string, to: string) {
    if (draft && selectedNode)
      commitGraph({
        ...draft,
        edges: draft.edges.map((edge) =>
          edge.from === selectedNode.id && edge.branch === branch
            ? { ...edge, to }
            : edge,
        ),
      })
  }
  function removeSelectedNode() {
    if (!draft || !selectedNode) return
    if (selectedNode.type === 'start' || selectedNode.type === 'end') {
      setFeedback({
        tone: 'error',
        text: 'Entrada e encerramento são estruturais.',
      })
      return
    }
    const outgoing = draft.edges.filter((edge) => edge.from === selectedNode.id)
    if (new Set(outgoing.map((edge) => edge.to)).size !== 1) {
      setFeedback({
        tone: 'error',
        text: 'Este bloco possui ramos diferentes. Reconecte-os ao mesmo destino antes de remover.',
      })
      return
    }
    const target = outgoing[0]?.to
    if (!target) return
    commitGraph({
      ...draft,
      nodes: draft.nodes.filter((node) => node.id !== selectedNode.id),
      edges: draft.edges
        .filter((edge) => edge.from !== selectedNode.id)
        .map((edge) =>
          edge.to === selectedNode.id ? { ...edge, to: target } : edge,
        ),
    })
    setSelectedNodeId(draft.entryNodeId)
  }

  const filteredFlows = (studio?.flows ?? []).filter((flow) =>
    flow.name
      .toLocaleLowerCase('pt-BR')
      .includes(query.toLocaleLowerCase('pt-BR')),
  )
  const canManage = studio?.permissions.canManage ?? false
  return (
    <div className="stack-lg automation-studio-page">
      <PageIntro
        title="Automação sem limite de trilho."
        description="Construa chatbots multicanal com decisões, IA, CRM, handoff, agenda, subfluxos e dados assinados para o n8n. Cada envio continua protegido pelo gateway Wal Chat."
        actions={
          <>
            <Link className="button button-outline" to="/gatilhos">
              <Sparkles size={16} /> Gatilhos
            </Link>
            <button
              className="button button-dark"
              onClick={() => void createFlow()}
              disabled={!canManage || Boolean(busy)}
            >
              <Plus size={16} /> Nova automação
            </button>
          </>
        }
      />
      <section className="automation-command-bar glass-panel">
        <div>
          <span className="automation-live-dot" />
          <strong>Automation Core v2</strong>
          <small>DAG versionado · execução idempotente · Meta-safe</small>
        </div>
        <div className="automation-command-metrics">
          <span>
            <b>{studio?.flows.length ?? 0}</b> jornadas
          </span>
          <span>
            <b>
              {studio?.flows.reduce(
                (sum, flow) => sum + flow.metrics.active,
                0,
              ) ?? 0}
            </b>{' '}
            em curso
          </span>
          <span>
            <b>11</b> blocos reais
          </span>
        </div>
      </section>
      {feedback && (
        <div
          className={
            feedback.tone === 'error'
              ? 'form-error'
              : feedback.tone === 'success'
                ? 'form-success'
                : 'form-info'
          }
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}
      <div className="automation-studio-shell">
        <aside className="automation-flow-library glass-panel">
          <header>
            <span className="eyebrow">JORNADAS</span>
            <button
              className="icon-button"
              aria-label="Criar automação"
              onClick={() => void createFlow()}
              disabled={!canManage || Boolean(busy)}
            >
              <Plus size={16} />
            </button>
          </header>
          <label className="automation-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar jornada"
              aria-label="Buscar jornada"
            />
          </label>
          <div className="automation-flow-list">
            {filteredFlows.map((flow) => (
              <button
                key={flow.id}
                className={selectedFlowId === flow.id ? 'active' : ''}
                onClick={() => void selectFlow(flow.id)}
              >
                <span className={`flow-status status-${flow.status}`} />
                <span>
                  <strong>{flow.name}</strong>
                  <small>
                    v{flow.current_version} · {flow.metrics.active} em curso
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
            {busy === 'load' && <LoaderCircle className="spin" size={18} />}
            {!busy && filteredFlows.length === 0 && (
              <p className="automation-empty">Nenhuma jornada encontrada.</p>
            )}
          </div>
        </aside>
        <main className="automation-workspace glass-panel">
          {!draft || !detail || !layout ? (
            <div className="automation-empty-state">
              <Workflow size={34} />
              <h2>Seu próximo chatbot começa aqui.</h2>
              <p>Crie uma automação para abrir o canvas de alta precisão.</p>
              <button
                className="button button-dark"
                onClick={() => void createFlow()}
              >
                <Plus size={16} /> Criar automação
              </button>
            </div>
          ) : (
            <>
              <header className="automation-workspace-head">
                <div className="automation-title-fields">
                  <input
                    value={flowName}
                    onChange={(event) => setFlowName(event.target.value)}
                    disabled={!canManage}
                    aria-label="Nome da automação"
                  />
                  <input
                    value={flowDescription}
                    onChange={(event) => setFlowDescription(event.target.value)}
                    disabled={!canManage}
                    placeholder="Objetivo da jornada"
                    aria-label="Descrição da automação"
                  />
                </div>
                <div className="automation-save-state">
                  <span className={`flow-badge status-${detail.flow.status}`}>
                    {detail.flow.status === 'published'
                      ? `PUBLICADA · V${detail.flow.current_version}`
                      : 'RASCUNHO'}
                  </span>
                  <small>
                    {hasChanges ? 'Alterações locais' : 'Sincronizado'}
                  </small>
                </div>
                <div className="automation-head-actions">
                  <button
                    className="icon-button"
                    aria-label="Desfazer"
                    title="Desfazer"
                    disabled={!history.length || !canManage}
                    onClick={() => {
                      const previous = history.at(-1)
                      if (previous) {
                        setDraft(previous)
                        setHistory((items) => items.slice(0, -1))
                      }
                    }}
                  >
                    <Undo2 size={16} />
                  </button>
                  <button
                    className="button button-outline"
                    onClick={validateDraft}
                  >
                    <Braces size={15} /> Validar
                  </button>
                  <button
                    className="button button-outline"
                    onClick={() => void saveDraft()}
                    disabled={!canManage || !hasChanges || Boolean(busy)}
                  >
                    {busy === 'save' ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Save size={15} />
                    )}{' '}
                    Salvar
                  </button>
                  <button
                    className="button button-orange"
                    onClick={() => void publishFlow()}
                    disabled={!canManage || Boolean(busy)}
                  >
                    {busy === 'publish' ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Rocket size={15} />
                    )}{' '}
                    Publicar
                  </button>
                </div>
              </header>
              <div
                className="automation-palette"
                aria-label="Blocos disponíveis"
              >
                {PALETTE.map((type) => {
                  const meta = NODE_META[type]
                  const Icon = meta.icon
                  return (
                    <button
                      key={type}
                      onClick={() => addNode(type)}
                      disabled={!canManage}
                      title={meta.description}
                    >
                      <span style={{ color: meta.color }}>
                        <Icon size={16} />
                      </span>
                      {meta.label}
                    </button>
                  )
                })}
              </div>
              <div className="automation-canvas-toolbar">
                <span>
                  <Boxes size={14} /> Canvas inteligente
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Reduzir zoom"
                    onClick={() =>
                      setZoom((value) => Math.max(0.55, value - 0.1))
                    }
                  >
                    <ZoomOut size={15} />
                  </button>
                  <b>{Math.round(zoom * 100)}%</b>
                  <button
                    className="icon-button"
                    aria-label="Aumentar zoom"
                    onClick={() =>
                      setZoom((value) => Math.min(1.25, value + 0.1))
                    }
                  >
                    <ZoomIn size={15} />
                  </button>
                </div>
              </div>
              <div className="automation-canvas-scroll">
                <div
                  className="automation-canvas"
                  style={{
                    width: layout.width * zoom,
                    height: layout.height * zoom,
                  }}
                >
                  <div
                    className="automation-canvas-stage"
                    style={{
                      width: layout.width,
                      height: layout.height,
                      transform: `scale(${zoom})`,
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      width={layout.width}
                      height={layout.height}
                    >
                      {draft.edges.map((edge) => {
                        const from = layout.positions.get(edge.from)
                        const to = layout.positions.get(edge.to)
                        if (!from || !to) return null
                        const startX = from.x + 232,
                          startY = from.y + 62,
                          endX = to.x,
                          endY = to.y + 62
                        return (
                          <g key={`${edge.from}-${edge.branch}`}>
                            <path
                              d={`M ${startX} ${startY} C ${startX + 55} ${startY}, ${endX - 55} ${endY}, ${endX} ${endY}`}
                            />
                            {edge.branch !== 'default' && (
                              <text
                                x={(startX + endX) / 2}
                                y={(startY + endY) / 2 - 6}
                              >
                                {branchLabel(edge.branch)}
                              </text>
                            )}
                          </g>
                        )
                      })}
                    </svg>
                    {draft.nodes.map((node) => {
                      const position = layout.positions.get(node.id)
                      return position ? (
                        <FlowNodeCard
                          key={node.id}
                          node={node}
                          selected={selectedNodeId === node.id}
                          position={position}
                          onSelect={() => setSelectedNodeId(node.id)}
                        />
                      ) : null
                    })}
                  </div>
                </div>
              </div>
              <footer className="automation-runtime-bar">
                <div>
                  <select
                    value={contactId}
                    onChange={(event) => setContactId(event.target.value)}
                    aria-label="Contato para teste"
                  >
                    <option value="">Selecione um contato real</option>
                    {catalogs?.contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name} · {contact.identity}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button button-dark"
                    onClick={() => void executeFlow()}
                    disabled={
                      !studio?.permissions.canExecute ||
                      detail.flow.status !== 'published' ||
                      !contactId ||
                      Boolean(busy)
                    }
                  >
                    {busy === 'execute' ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Send size={15} />
                    )}{' '}
                    Executar com segurança
                  </button>
                </div>
                <span>
                  {detail.executions.length} execuções recentes ·{' '}
                  {detail.versions.length} versões
                </span>
              </footer>
            </>
          )}
        </main>
        <aside className="automation-inspector glass-panel">
          <header>
            <span className="eyebrow">INSPETOR</span>
            {selectedNode && <span>{NODE_META[selectedNode.type].label}</span>}
          </header>
          {selectedNode && draft && catalogs ? (
            <NodeInspector
              node={selectedNode}
              graph={draft}
              catalogs={catalogs}
              flows={(studio?.flows ?? []).filter(
                (flow) =>
                  flow.status === 'published' && flow.id !== detail?.flow.id,
              )}
              onChange={updateNode}
              onEdgeChange={updateEdge}
              onDelete={removeSelectedNode}
              canManage={canManage}
            />
          ) : (
            <div className="automation-empty">
              Selecione um bloco no canvas.
            </div>
          )}
          {detail && (
            <div className="automation-inspector-danger">
              <button
                className="button button-outline danger"
                onClick={() => void archiveFlow()}
                disabled={!canManage || Boolean(busy)}
              >
                <Trash2 size={14} /> Arquivar jornada
              </button>
            </div>
          )}
        </aside>
      </div>
      {detail && <ExecutionTrail executions={detail.executions} />}
    </div>
  )
}

function FlowNodeCard({
  node,
  selected,
  position,
  onSelect,
}: {
  node: AutomationNode
  selected: boolean
  position: { x: number; y: number }
  onSelect: () => void
}) {
  const meta = NODE_META[node.type],
    Icon = meta.icon
  return (
    <button
      className={`automation-node type-${node.type} ${selected ? 'selected' : ''}`}
      style={
        {
          left: position.x,
          top: position.y,
          '--node-color': meta.color,
        } as React.CSSProperties
      }
      onClick={onSelect}
    >
      <span className="automation-node-icon">
        <Icon size={17} />
      </span>
      <span>
        <small>{meta.label.toUpperCase()}</small>
        <strong>{nodeSummary(node)}</strong>
        <em>{node.id}</em>
      </span>
      <i />
    </button>
  )
}

function NodeInspector(props: {
  node: AutomationNode
  graph: AutomationGraph
  catalogs: Catalogs
  flows: FlowSummary[]
  onChange: (node: AutomationNode) => void
  onEdgeChange: (branch: string, to: string) => void
  onDelete: () => void
  canManage: boolean
}) {
  const { node, catalogs } = props,
    disabled = !props.canManage
  const outgoing = props.graph.edges.filter((edge) => edge.from === node.id)
  const targets = props.graph.nodes.filter((item) => item.id !== node.id)
  return (
    <div className="automation-inspector-body">
      <div className="automation-node-identity">
        <span style={{ background: NODE_META[node.type].color }}>
          {(() => {
            const Icon = NODE_META[node.type].icon
            return <Icon size={17} />
          })()}
        </span>
        <div>
          <strong>{NODE_META[node.type].label}</strong>
          <small>{NODE_META[node.type].description}</small>
        </div>
      </div>
      {node.type === 'message' && (
        <>
          <Field label="Mensagem">
            <textarea
              value={node.config.text}
              maxLength={1000}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: { ...node.config, text: event.target.value },
                })
              }
            />
          </Field>
          <Field label="URL de mídia HTTPS">
            <input
              type="url"
              value={node.config.mediaUrl ?? ''}
              disabled={disabled}
              placeholder="https://..."
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: {
                    ...node.config,
                    mediaUrl: event.target.value || null,
                    mediaType: event.target.value
                      ? (node.config.mediaType ?? 'image')
                      : null,
                  },
                })
              }
            />
          </Field>
          {node.config.mediaUrl && (
            <Field label="Tipo da mídia">
              <select
                value={node.config.mediaType ?? 'image'}
                disabled={disabled}
                onChange={(event) =>
                  props.onChange({
                    ...node,
                    config: {
                      ...node.config,
                      mediaType: event.target.value as 'image' | 'video',
                    },
                  })
                }
              >
                <option value="image">Imagem</option>
                <option value="video">Vídeo</option>
              </select>
            </Field>
          )}
          <Field label="Página de agendamento">
            <select
              value={node.config.bookingPageId ?? ''}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: {
                    ...node.config,
                    bookingPageId: event.target.value || null,
                  },
                })
              }
            >
              <option value="">Sem link de agenda</option>
              {catalogs.bookingPages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {node.type === 'ai_reply' && (
        <>
          <Field label="Agente ativo">
            <select
              value={node.config.agentId}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: { ...node.config, agentId: event.target.value },
                })
              }
            >
              {catalogs.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Objetivo e contexto">
            <textarea
              value={node.config.prompt}
              maxLength={2000}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: { ...node.config, prompt: event.target.value },
                })
              }
            />
          </Field>
          <p className="automation-safety-note">
            Exige Agentes autônomos ativos no Go-Live. A resposta passa pelo
            gateway.
          </p>
        </>
      )}
      {node.type === 'delay' && (
        <Field label="Tempo de espera">
          <div className="automation-duration">
            <input
              type="number"
              min={1}
              max={10080}
              value={durationValue(node.config.seconds)}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: {
                    seconds:
                      Math.max(1, Number(event.target.value)) *
                      durationUnitSeconds(node.config.seconds),
                  },
                })
              }
            />
            <select
              value={durationUnitSeconds(node.config.seconds)}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: {
                    seconds:
                      durationValue(node.config.seconds) *
                      Number(event.target.value),
                  },
                })
              }
            >
              <option value={60}>minutos</option>
              <option value={3600}>horas</option>
              <option value={86400}>dias</option>
            </select>
          </div>
        </Field>
      )}
      {node.type === 'condition' && (
        <>
          <Field label="Origem">
            <select
              value={node.config.source}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: {
                    ...node.config,
                    source: event.target.value as typeof node.config.source,
                  },
                })
              }
            >
              <option value="contact">Contato</option>
              <option value="custom">Campo personalizado</option>
              <option value="bot">Campo global</option>
              <option value="context">Contexto do gatilho</option>
            </select>
          </Field>
          <Field label="Campo">
            <input
              value={node.config.field}
              disabled={disabled}
              list="automation-fields"
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: { ...node.config, field: event.target.value },
                })
              }
            />
            <datalist id="automation-fields">
              {[
                'lead_score',
                'lifecycle_stage',
                'last_inbound_at',
                ...catalogs.customFields.map((field) => field.field_key),
                ...catalogs.botFields.map((field) => field.field_key),
              ].map((field) => (
                <option value={field} key={field} />
              ))}
            </datalist>
          </Field>
          <Field label="Operador">
            <select
              value={node.config.operator}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: {
                    ...node.config,
                    operator: event.target.value as typeof node.config.operator,
                  },
                })
              }
            >
              <option value="equals">é igual a</option>
              <option value="does_not_equal">é diferente de</option>
              <option value="contains">contém</option>
              <option value="does_not_contain">não contém</option>
              <option value="starts_with">começa com</option>
              <option value="is_set">está preenchido</option>
              <option value="is_not_set">não está preenchido</option>
              <option value="greater_than">maior que</option>
              <option value="less_than">menor que</option>
              <option value="in_24h_window">está na janela de 24h</option>
            </select>
          </Field>
          {!['is_set', 'is_not_set', 'in_24h_window'].includes(
            node.config.operator,
          ) && (
            <Field label="Valor">
              <input
                value={String(node.config.value ?? '')}
                disabled={disabled}
                onChange={(event) =>
                  props.onChange({
                    ...node,
                    config: {
                      ...node.config,
                      value: parseScalar(event.target.value),
                    },
                  })
                }
              />
            </Field>
          )}
        </>
      )}
      {node.type === 'random_split' && (
        <div className="automation-ab-grid">
          {node.config.branches.map((branch, index) => (
            <Field label={`Ramo ${branch.key.toUpperCase()}`} key={branch.key}>
              <input
                type="number"
                min={1}
                max={99}
                value={branch.weight}
                disabled={disabled}
                onChange={(event) => {
                  const weight = Math.max(
                      1,
                      Math.min(99, Number(event.target.value)),
                    ),
                    other = 100 - weight
                  props.onChange({
                    ...node,
                    config: {
                      branches: node.config.branches.map((item, current) => ({
                        ...item,
                        weight: current === index ? weight : other,
                      })),
                    },
                  })
                }}
              />
            </Field>
          ))}
        </div>
      )}
      {node.type === 'action' && (
        <ActionEditor
          node={node}
          catalogs={catalogs}
          disabled={disabled}
          onChange={props.onChange}
        />
      )}
      {node.type === 'handoff' && (
        <>
          <Field label="Fila da Inbox">
            <select
              value={node.config.category}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: {
                    ...node.config,
                    category: event.target.value as typeof node.config.category,
                  },
                })
              }
            >
              <option value="principal">Principal</option>
              <option value="geral">Geral</option>
              <option value="pedidos">Pedidos</option>
              <option value="ia_off">IA off</option>
            </select>
          </Field>
          <Field label="Prioridade">
            <select
              value={node.config.priority}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: {
                    ...node.config,
                    priority: event.target.value as typeof node.config.priority,
                  },
                })
              }
            >
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </Field>
          <Field label="Nota interna">
            <textarea
              value={node.config.note ?? ''}
              maxLength={500}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: { ...node.config, note: event.target.value || null },
                })
              }
            />
          </Field>
        </>
      )}
      {node.type === 'n8n_event' && (
        <>
          <div
            className={`automation-connector-state ${catalogs.n8nConnected ? 'ready' : ''}`}
          >
            <Webhook size={15} />{' '}
            {catalogs.n8nConnected
              ? 'n8n conectado'
              : 'n8n precisa ser conectado'}
          </div>
          <Field label="Nome do evento">
            <input
              value={node.config.eventName}
              disabled={disabled}
              onChange={(event) =>
                props.onChange({
                  ...node,
                  config: { ...node.config, eventName: event.target.value },
                })
              }
            />
          </Field>
          <ExternalFieldsEditor
            fields={node.config.fields}
            disabled={disabled}
            onChange={(fields) =>
              props.onChange({ ...node, config: { ...node.config, fields } })
            }
          />
          {!catalogs.n8nConnected && (
            <Link to="/integracoes" className="button button-outline">
              Configurar n8n
            </Link>
          )}
        </>
      )}
      {node.type === 'subflow' && (
        <Field label="Jornada publicada">
          <select
            value={node.config.flowId}
            disabled={disabled}
            onChange={(event) =>
              props.onChange({
                ...node,
                config: { flowId: event.target.value },
              })
            }
          >
            {props.flows.map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.name} · v{flow.current_version}
              </option>
            ))}
          </select>
        </Field>
      )}
      {node.type === 'end' && (
        <Field label="Resultado">
          <input
            value={node.config?.outcome ?? ''}
            maxLength={80}
            disabled={disabled}
            onChange={(event) =>
              props.onChange({
                ...node,
                config: { outcome: event.target.value || undefined },
              })
            }
          />
        </Field>
      )}
      {outgoing.length > 0 && (
        <section className="automation-routing">
          <strong>ROTAS DE SAÍDA</strong>
          {outgoing.map((edge) => (
            <Field label={branchLabel(edge.branch)} key={edge.branch}>
              <select
                value={edge.to}
                disabled={disabled}
                onChange={(event) =>
                  props.onEdgeChange(edge.branch, event.target.value)
                }
              >
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {NODE_META[target.type].label} · {target.id}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </section>
      )}
      {!['start', 'end'].includes(node.type) && (
        <button
          className="button button-outline danger automation-delete-node"
          disabled={disabled}
          onClick={props.onDelete}
        >
          <Trash2 size={14} /> Remover bloco
        </button>
      )}
    </div>
  )
}

function ActionEditor({
  node,
  catalogs,
  disabled,
  onChange,
}: {
  node: Extract<AutomationNode, { type: 'action' }>
  catalogs: Catalogs
  disabled: boolean
  onChange: (node: AutomationNode) => void
}) {
  const update = (index: number, action: AutomationAction) =>
    onChange({
      ...node,
      config: {
        actions: node.config.actions.map((item, current) =>
          current === index ? action : item,
        ),
      },
    })
  return (
    <section className="automation-action-list">
      {node.config.actions.map((action, index) => (
        <div key={`${action.type}-${index}`}>
          <Field label="Ação">
            <select
              value={action.type}
              disabled={disabled}
              onChange={(event) =>
                update(index, defaultAction(event.target.value, catalogs))
              }
            >
              <option value="add_tag">Adicionar tag</option>
              <option value="remove_tag">Remover tag</option>
              <option value="set_custom_field">Definir campo do contato</option>
              <option value="clear_custom_field">
                Limpar campo do contato
              </option>
              <option value="set_bot_field">Definir campo global</option>
            </select>
          </Field>
          {(action.type === 'add_tag' || action.type === 'remove_tag') && (
            <Field label="Tag">
              <select
                value={action.tagId}
                disabled={disabled}
                onChange={(event) =>
                  update(index, { ...action, tagId: event.target.value })
                }
              >
                {catalogs.tags.map((tag) => (
                  <option value={tag.id} key={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(action.type === 'set_custom_field' ||
            action.type === 'clear_custom_field') && (
            <Field label="Campo">
              <select
                value={action.fieldKey}
                disabled={disabled}
                onChange={(event) =>
                  update(index, { ...action, fieldKey: event.target.value })
                }
              >
                {catalogs.customFields.map((field) => (
                  <option value={field.field_key} key={field.field_key}>
                    {field.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {action.type === 'set_bot_field' && (
            <Field label="Campo global">
              <select
                value={action.fieldKey}
                disabled={disabled}
                onChange={(event) =>
                  update(index, { ...action, fieldKey: event.target.value })
                }
              >
                {catalogs.botFields.map((field) => (
                  <option value={field.field_key} key={field.field_key}>
                    {field.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(action.type === 'set_custom_field' ||
            action.type === 'set_bot_field') && (
            <Field label="Valor">
              <input
                value={String(action.value ?? '')}
                disabled={disabled}
                onChange={(event) =>
                  update(index, {
                    ...action,
                    value: parseScalar(event.target.value),
                  })
                }
              />
            </Field>
          )}
          {node.config.actions.length > 1 && (
            <button
              className="icon-button"
              aria-label="Remover ação"
              onClick={() =>
                onChange({
                  ...node,
                  config: {
                    actions: node.config.actions.filter(
                      (_, current) => current !== index,
                    ),
                  },
                })
              }
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      <button
        className="button button-outline"
        disabled={disabled || node.config.actions.length >= 10}
        onClick={() =>
          onChange({
            ...node,
            config: {
              actions: [
                ...node.config.actions,
                defaultAction('add_tag', catalogs),
              ],
            },
          })
        }
      >
        <Plus size={14} /> Outra ação
      </button>
    </section>
  )
}

function ExternalFieldsEditor({
  fields,
  disabled,
  onChange,
}: {
  fields: Array<{ key: string; value: string }>
  disabled: boolean
  onChange: (fields: Array<{ key: string; value: string }>) => void
}) {
  return (
    <section className="automation-external-fields">
      <strong>DADOS ENVIADOS</strong>
      {fields.map((field, index) => (
        <div key={index}>
          <input
            aria-label="Chave externa"
            value={field.key}
            disabled={disabled}
            placeholder="lead.score"
            onChange={(event) =>
              onChange(
                fields.map((item, current) =>
                  current === index
                    ? { ...item, key: event.target.value }
                    : item,
                ),
              )
            }
          />
          <input
            aria-label="Valor externo"
            value={field.value}
            disabled={disabled}
            placeholder="{{custom.score}}"
            onChange={(event) =>
              onChange(
                fields.map((item, current) =>
                  current === index
                    ? { ...item, value: event.target.value }
                    : item,
                ),
              )
            }
          />
          <button
            className="icon-button"
            aria-label="Remover campo"
            onClick={() =>
              onChange(fields.filter((_, current) => current !== index))
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        className="button button-outline"
        disabled={disabled || fields.length >= 30}
        onClick={() =>
          onChange([
            ...fields,
            { key: `campo_${fields.length + 1}`, value: '' },
          ])
        }
      >
        <Plus size={14} /> Adicionar dado
      </button>
    </section>
  )
}
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="automation-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function ExecutionTrail({
  executions,
}: {
  executions: FlowDetail['executions']
}) {
  return (
    <section className="card automation-executions">
      <header>
        <div>
          <span className="eyebrow">OBSERVABILIDADE</span>
          <h2>Trilha de execução</h2>
        </div>
        <span>Últimas {executions.length} execuções</span>
      </header>
      <div className="automation-execution-grid">
        {executions.slice(0, 12).map((execution) => (
          <article key={execution.id}>
            <span className={`execution-status status-${execution.status}`} />
            <div>
              <strong>{execution.id.slice(0, 8)}</strong>
              <small>
                {new Date(execution.started_at).toLocaleString('pt-BR')}
              </small>
            </div>
            <span>{execution.current_node_id ?? '—'}</span>
            <b>{execution.steps_count} passos</b>
            {execution.last_error_code && <em>{execution.last_error_code}</em>}
          </article>
        ))}
        {executions.length === 0 && (
          <p className="automation-empty">
            Nenhuma execução ainda. Publique e escolha um contato para testar.
          </p>
        )}
      </div>
    </section>
  )
}

function starterGraph(): AutomationGraph {
  return {
    schemaVersion: 2,
    entryNodeId: 'start',
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'welcome',
        type: 'message',
        config: { text: 'Oi, {{contact.display_name}}! Como posso te ajudar?' },
      },
      { id: 'end', type: 'end', config: { outcome: 'completed' } },
    ],
    edges: [
      { from: 'start', to: 'welcome', branch: 'default' },
      { from: 'welcome', to: 'end', branch: 'default' },
    ],
  }
}

function createNode(
  type: NodeType,
  catalogs: Catalogs,
  flows: FlowSummary[],
): AutomationNode {
  const id = `n_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  if (type === 'message')
    return {
      id,
      type,
      config: { text: 'Escreva sua mensagem para {{contact.display_name}}.' },
    }
  if (type === 'ai_reply') {
    const agent = catalogs.agents.at(0)
    if (!agent)
      throw new Error('Crie e ative um Agente de IA antes de usar este bloco.')
    return {
      id,
      type,
      config: {
        agentId: agent.id,
        prompt:
          'Atenda a intenção atual do contato com base no conhecimento aprovado.',
      },
    }
  }
  if (type === 'delay') return { id, type, config: { seconds: 3600 } }
  if (type === 'condition')
    return {
      id,
      type,
      config: {
        source: 'contact',
        field: 'lead_score',
        operator: 'greater_than',
        value: 50,
      },
    }
  if (type === 'random_split')
    return {
      id,
      type,
      config: {
        branches: [
          { key: 'a', weight: 50 },
          { key: 'b', weight: 50 },
        ],
      },
    }
  if (type === 'action')
    return {
      id,
      type,
      config: { actions: [defaultAction('add_tag', catalogs)] },
    }
  if (type === 'handoff')
    return {
      id,
      type,
      config: {
        category: 'principal',
        priority: 'high',
        note: 'Conversa encaminhada automaticamente para atendimento humano.',
      },
    }
  if (type === 'n8n_event')
    return {
      id,
      type,
      config: {
        eventName: 'lead.updated',
        fields: [
          { key: 'contact_id', value: '{{contact.id}}' },
          { key: 'lead_score', value: '{{contact.lead_score}}' },
        ],
      },
    }
  if (type === 'subflow') {
    const flow = flows.at(0)
    if (!flow)
      throw new Error('Publique outra jornada antes de adicionar um subfluxo.')
    return { id, type, config: { flowId: flow.id } }
  }
  if (type === 'end') return { id, type, config: { outcome: 'completed' } }
  throw new Error('Este bloco é estrutural e não pode ser adicionado.')
}

function insertAfterSelection(
  graph: AutomationGraph,
  selectedId: string,
  node: AutomationNode,
): AutomationGraph {
  const outgoing = graph.edges.filter((edge) => edge.from === selectedId)
  const edge =
    outgoing.find((item) => item.branch === 'default') ??
    outgoing.at(0) ??
    graph.edges.find((item) => item.to === selectedId)
  if (!edge)
    throw new Error(
      'Não foi possível encontrar uma conexão para inserir o bloco.',
    )
  const target = edge.to === selectedId ? selectedId : edge.to
  const entryEdge = { ...edge, to: node.id }
  const branches =
    node.type === 'condition'
      ? [
          { from: node.id, to: target, branch: 'true' },
          { from: node.id, to: target, branch: 'false' },
        ]
      : node.type === 'random_split'
        ? node.config.branches.map((branch) => ({
            from: node.id,
            to: target,
            branch: branch.key,
          }))
        : [{ from: node.id, to: target, branch: 'default' }]
  return {
    ...graph,
    schemaVersion: 2,
    nodes: [...graph.nodes, node],
    edges: [
      ...graph.edges.filter((item) => item !== edge),
      entryEdge,
      ...branches,
    ],
  }
}

function defaultAction(type: string, catalogs: Catalogs): AutomationAction {
  if (type === 'add_tag' || type === 'remove_tag') {
    const tag = catalogs.tags.at(0)
    if (!tag)
      throw new Error('Crie uma tag no CRM antes de adicionar esta ação.')
    return { type, tagId: tag.id }
  }
  if (type === 'set_custom_field' || type === 'clear_custom_field') {
    const field = catalogs.customFields.at(0)
    if (!field)
      throw new Error('Crie um campo personalizado antes de usar esta ação.')
    return type === 'clear_custom_field'
      ? { type, fieldKey: field.field_key }
      : { type, fieldKey: field.field_key, value: '' }
  }
  const field = catalogs.botFields.at(0)
  if (!field) throw new Error('Crie um campo global antes de usar esta ação.')
  return { type: 'set_bot_field', fieldKey: field.field_key, value: '' }
}

function layoutGraph(graph: AutomationGraph) {
  const depths = new Map<string, number>([[graph.entryNodeId, 0]])
  for (const _node of graph.nodes)
    for (const edge of graph.edges) {
      const depth = depths.get(edge.from)
      if (depth !== undefined)
        depths.set(edge.to, Math.max(depths.get(edge.to) ?? 0, depth + 1))
    }
  const columns = new Map<number, AutomationNode[]>()
  for (const node of graph.nodes) {
    const depth = Math.min(depths.get(node.id) ?? 0, graph.nodes.length)
    columns.set(depth, [...(columns.get(depth) ?? []), node])
  }
  const positions = new Map<string, { x: number; y: number }>()
  let maxRows = 1
  for (const [depth, nodes] of columns) {
    maxRows = Math.max(maxRows, nodes.length)
    nodes.forEach((node, index) =>
      positions.set(node.id, { x: 38 + depth * 310, y: 34 + index * 156 }),
    )
  }
  const maxDepth = Math.max(...columns.keys())
  return {
    positions,
    width: Math.max(900, 40 + (maxDepth + 1) * 310),
    height: Math.max(520, 80 + maxRows * 156),
  }
}

function nodeSummary(node: AutomationNode) {
  if (node.type === 'start') return 'Gatilho ou chamada externa'
  if (node.type === 'message') return node.config.text.slice(0, 54)
  if (node.type === 'ai_reply') return node.config.prompt.slice(0, 54)
  if (node.type === 'delay')
    return `${durationValue(node.config.seconds)} ${durationUnitLabel(node.config.seconds)}`
  if (node.type === 'condition')
    return `${node.config.source}.${node.config.field}`
  if (node.type === 'random_split')
    return node.config.branches
      .map((branch) => `${branch.key.toUpperCase()} ${branch.weight}%`)
      .join(' · ')
  if (node.type === 'action')
    return `${node.config.actions.length} alteração(ões) no CRM`
  if (node.type === 'handoff')
    return `${node.config.category} · prioridade ${node.config.priority}`
  if (node.type === 'n8n_event') return node.config.eventName
  if (node.type === 'subflow') return `Fluxo ${node.config.flowId.slice(0, 8)}`
  return node.config?.outcome ?? 'Jornada concluída'
}
function durationUnitSeconds(seconds: number) {
  if (seconds % 86400 === 0) return 86400
  if (seconds % 3600 === 0) return 3600
  return 60
}
function durationValue(seconds: number) {
  return Math.max(1, Math.round(seconds / durationUnitSeconds(seconds)))
}
function durationUnitLabel(seconds: number) {
  const unit = durationUnitSeconds(seconds)
  return unit === 86400 ? 'dia(s)' : unit === 3600 ? 'hora(s)' : 'minuto(s)'
}
function branchLabel(branch: string) {
  return branch === 'default'
    ? 'Próximo'
    : branch === 'true'
      ? 'Sim'
      : branch === 'false'
        ? 'Não'
        : `Ramo ${branch.toUpperCase()}`
}
function parseScalar(value: string): string | number | boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  const number = Number(value)
  return value.trim() && Number.isFinite(number) ? number : value
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Ocorreu uma falha inesperada.'
}
function friendlyGraphError(error: unknown) {
  const message = errorMessage(error)
  if (
    error instanceof AutomationGraphError ||
    message.includes('invalid_node_branches')
  )
    return `Fluxo incompleto: revise as rotas do bloco ${message.split(':')[1] ?? 'selecionado'}.`
  if (message.includes('cycle_detected'))
    return 'Fluxo inválido: uma conexão criou um ciclo. Use um subfluxo controlado para recorrência.'
  if (message.includes('unreachable_node'))
    return `Fluxo inválido: existe um bloco sem caminho desde a entrada (${message.split(':')[1] ?? ''}).`
  return message
}
