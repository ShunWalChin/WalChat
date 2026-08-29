/** Governança operacional de IA, orçamento, memória, casos e observabilidade. */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Activity,
  Bot,
  BrainCircuit,
  CircleDollarSign,
  GitBranch,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { PageIntro, StatusDot, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import './deskcomm.css'

type GovernanceData = {
  provider: { provider: string; model: string; is_enabled: boolean } | null
  budget: {
    monthlyTokenLimit: number
    warningPercent: number
    hardStop: boolean
    tokensUsed: number
    percentUsed: number
  }
  summary: {
    agents: number
    activeAgents: number
    openCases: number
    executions: number
    successRate: number
    averageLatencyMs: number
  }
  agents: Array<{ id: string; name: string; is_active: boolean }>
  versions: Array<{
    id: string
    agent_id: string
    agentName: string
    version: number
    change_summary: string
    status: string
    created_at: string
  }>
  routers: Array<{
    id: string
    name: string
    description: string | null
    strategy: string
    is_active: boolean
    members: Array<{ agent_id: string; intent: string; priority: number }>
  }>
  memory: Array<{
    id: string
    memory_key: string
    value: string
    source: string
    is_active: boolean
    updated_at: string
  }>
  cases: Array<{
    id: string
    title: string
    reason: string
    priority: string
    status: string
    agentName: string | null
    assignedName: string | null
    assigned_to: string | null
    created_at: string
  }>
  executions: Array<{
    id: string
    agentName: string | null
    provider: string
    model: string
    purpose: string
    status: string
    input_tokens: number
    output_tokens: number
    latency_ms: number
    created_at: string
  }>
  members: Array<{ id: string; name: string }>
  permissions: { canManage: boolean; canOperate: boolean }
}

export const Route = createFileRoute('/_app/governanca')({
  component: GovernancePage,
})

function GovernancePage() {
  const [data, setData] = useState<GovernanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await apiFetch<GovernanceData>('/api/governance'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => void load(), [load])

  async function submit(kind: string, body: Record<string, unknown>) {
    setBusy(kind)
    setError(null)
    try {
      await apiFetch('/api/governance', {
        method: 'POST',
        body: JSON.stringify({ kind, ...body }),
      })
      setFeedback('Governança atualizada com sucesso.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar.')
    } finally {
      setBusy(null)
    }
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(String(body.id ?? body.kind))
    setError(null)
    try {
      await apiFetch('/api/governance', {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setFeedback('Estado atualizado.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao alterar.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack-lg deskcomm-page">
      <PageIntro
        title="IA sob controle, sem perder velocidade."
        description="Orçamento, versões, roteadores, memória organizacional, casos humanos e cada execução em uma trilha única."
        actions={
          <div className="button-row">
            <Link to="/agentes" className="button button-outline">
              <Bot size={16} /> Editar agentes
            </Link>
            <button
              className="button button-dark"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={loading ? 'spin' : ''} size={16} />{' '}
              Atualizar
            </button>
          </div>
        }
      />
      <div className="mini-stats deskcomm-stats">
        <GovernanceStat
          icon={<Bot />}
          value={data?.summary.activeAgents ?? 0}
          label="agentes ativos"
        />
        <GovernanceStat
          icon={<Activity />}
          value={`${data?.summary.successRate ?? 0}%`}
          label="execuções concluídas"
        />
        <GovernanceStat
          icon={<ShieldCheck />}
          value={data?.summary.openCases ?? 0}
          label="casos em aberto"
        />
        <GovernanceStat
          icon={<BrainCircuit />}
          value={`${data?.summary.averageLatencyMs ?? 0} ms`}
          label="latência média"
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
      {loading && !data ? (
        <div className="card deskcomm-loading">
          <LoaderCircle className="spin" /> Carregando governança…
        </div>
      ) : data ? (
        <>
          <div className="governance-grid">
            <BudgetCard data={data} busy={busy} onSave={submit} />
            <MemoryCard
              data={data}
              busy={busy}
              onCreate={submit}
              onPatch={patch}
            />
            <RouterCard
              data={data}
              busy={busy}
              onCreate={submit}
              onPatch={patch}
            />
            <VersionCard data={data} busy={busy} onCreate={submit} />
          </div>
          <CasesCard
            data={data}
            busy={busy}
            onCreate={submit}
            onPatch={patch}
          />
          <ExecutionCard data={data} />
        </>
      ) : null}
    </div>
  )
}

function BudgetCard({
  data,
  busy,
  onSave,
}: {
  data: GovernanceData
  busy: string | null
  onSave: (kind: string, body: Record<string, unknown>) => Promise<void>
}) {
  const [limit, setLimit] = useState(data.budget.monthlyTokenLimit)
  const [warning, setWarning] = useState(data.budget.warningPercent)
  const [hardStop, setHardStop] = useState(data.budget.hardStop)
  return (
    <section className="card governance-card">
      <header className="deskcomm-section-header">
        <div>
          <strong>Orçamento mensal</strong>
          <span>
            {data.budget.tokensUsed.toLocaleString('pt-BR')} tokens consumidos
            neste mês
          </span>
        </div>
        <CircleDollarSign size={19} />
      </header>
      <form
        className="deskcomm-form"
        onSubmit={(event) => {
          event.preventDefault()
          void onSave('budget', {
            monthlyTokenLimit: limit,
            warningPercent: warning,
            hardStop,
          })
        }}
      >
        <div
          className="budget-meter"
          aria-label={`${Math.round(data.budget.percentUsed)}% do orçamento consumido`}
        >
          <span style={{ width: `${data.budget.percentUsed}%` }} />
        </div>
        <small className="field-help">
          {Math.round(data.budget.percentUsed)}% usado. Use zero para não
          limitar tokens.
        </small>
        <div className="deskcomm-form-grid">
          <label>
            Limite de tokens
            <input
              type="number"
              min="0"
              max="10000000000"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              disabled={!data.permissions.canManage}
            />
          </label>
          <label>
            Alerta em %
            <input
              type="number"
              min="1"
              max="100"
              value={warning}
              onChange={(event) => setWarning(Number(event.target.value))}
              disabled={!data.permissions.canManage}
            />
          </label>
        </div>
        <div className="deskcomm-switch-row">
          <div>
            <strong>Bloqueio rígido</strong>
            <span>Interrompe novas gerações ao atingir o limite.</span>
          </div>
          <Switch
            checked={hardStop}
            label="Bloqueio rígido"
            disabled={!data.permissions.canManage}
            onChange={() => setHardStop((value) => !value)}
          />
        </div>
        {data.permissions.canManage && (
          <button className="button button-dark" disabled={busy === 'budget'}>
            {busy === 'budget' ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}{' '}
            Salvar orçamento
          </button>
        )}
      </form>
    </section>
  )
}

function MemoryCard({
  data,
  busy,
  onCreate,
  onPatch,
}: {
  data: GovernanceData
  busy: string | null
  onCreate: (kind: string, body: Record<string, unknown>) => Promise<void>
  onPatch: (body: Record<string, unknown>) => Promise<void>
}) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  async function create(event: FormEvent) {
    event.preventDefault()
    await onCreate('memory', { key, value, source: 'manual' })
    setKey('')
    setValue('')
  }
  return (
    <section className="card governance-card">
      <header className="deskcomm-section-header">
        <div>
          <strong>Memória organizacional</strong>
          <span>Fatos aprovados e reutilizáveis pelos agentes</span>
        </div>
        <BrainCircuit size={19} />
      </header>
      {data.permissions.canManage && (
        <form
          className="compact-create-form"
          onSubmit={(event) => void create(event)}
        >
          <input
            value={key}
            onChange={(event) => setKey(event.target.value.toLowerCase())}
            placeholder="chave.exemplo"
            required
            pattern="[a-z0-9][a-z0-9_.-]{1,79}"
          />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Informação aprovada"
            required
            maxLength={4000}
          />
          <button
            className="button button-outline"
            disabled={busy === 'memory'}
          >
            <Plus size={15} /> Adicionar
          </button>
        </form>
      )}
      <div className="governance-list">
        {data.memory.length ? (
          data.memory.map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.memory_key}</strong>
                <p>{item.value}</p>
                <small>
                  {item.source} ·{' '}
                  {new Date(item.updated_at).toLocaleDateString('pt-BR')}
                </small>
              </div>
              <Switch
                checked={item.is_active}
                label={`Ativar ${item.memory_key}`}
                disabled={!data.permissions.canManage || busy === item.id}
                onChange={() =>
                  void onPatch({
                    kind: 'memory_status',
                    id: item.id,
                    active: !item.is_active,
                  })
                }
              />
            </article>
          ))
        ) : (
          <p className="compact-empty">Nenhuma memória cadastrada.</p>
        )}
      </div>
    </section>
  )
}

function RouterCard({
  data,
  busy,
  onCreate,
  onPatch,
}: {
  data: GovernanceData
  busy: string | null
  onCreate: (kind: string, body: Record<string, unknown>) => Promise<void>
  onPatch: (body: Record<string, unknown>) => Promise<void>
}) {
  const [name, setName] = useState('')
  async function create(event: FormEvent) {
    event.preventDefault()
    await onCreate('router', {
      name,
      strategy: 'intent',
      fallbackAgentId: null,
    })
    setName('')
  }
  return (
    <section className="card governance-card">
      <header className="deskcomm-section-header">
        <div>
          <strong>Roteadores de agentes</strong>
          <span>Estratégias para distribuir intenções</span>
        </div>
        <GitBranch size={19} />
      </header>
      {data.permissions.canManage && (
        <form
          className="compact-create-form"
          onSubmit={(event) => void create(event)}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Comercial e suporte"
            required
            maxLength={100}
          />
          <button
            className="button button-outline"
            disabled={busy === 'router'}
          >
            <Plus size={15} /> Criar
          </button>
        </form>
      )}
      <div className="governance-list">
        {data.routers.length ? (
          data.routers.map((router) => (
            <article key={router.id}>
              <div>
                <strong>{router.name}</strong>
                <p>
                  {router.description ||
                    `${router.strategy} · ${router.members.length} agente(s)`}
                </p>
              </div>
              <Switch
                checked={router.is_active}
                label={`Ativar ${router.name}`}
                disabled={!data.permissions.canManage || busy === router.id}
                onChange={() =>
                  void onPatch({
                    kind: 'router_status',
                    id: router.id,
                    active: !router.is_active,
                  })
                }
              />
            </article>
          ))
        ) : (
          <p className="compact-empty">Nenhum roteador cadastrado.</p>
        )}
      </div>
    </section>
  )
}

function VersionCard({
  data,
  busy,
  onCreate,
}: {
  data: GovernanceData
  busy: string | null
  onCreate: (kind: string, body: Record<string, unknown>) => Promise<void>
}) {
  const [agentId, setAgentId] = useState(data.agents[0]?.id ?? '')
  const [summary, setSummary] = useState('')
  async function create(event: FormEvent) {
    event.preventDefault()
    await onCreate('version', { agentId, changeSummary: summary })
    setSummary('')
  }
  return (
    <section className="card governance-card">
      <header className="deskcomm-section-header">
        <div>
          <strong>Versões de agentes</strong>
          <span>Snapshots auditáveis antes de mudanças</span>
        </div>
        <ShieldCheck size={19} />
      </header>
      {data.permissions.canManage && data.agents.length > 0 && (
        <form
          className="compact-create-form"
          onSubmit={(event) => void create(event)}
        >
          <select
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          >
            {data.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Resumo da alteração"
            required
            maxLength={500}
          />
          <button
            className="button button-outline"
            disabled={busy === 'version'}
          >
            <Plus size={15} /> Snapshot
          </button>
        </form>
      )}
      <div className="governance-list">
        {data.versions.slice(0, 6).map((version) => (
          <article key={version.id}>
            <div>
              <strong>
                {version.agentName} · v{version.version}
              </strong>
              <p>{version.change_summary}</p>
              <small>
                {version.status} ·{' '}
                {new Date(version.created_at).toLocaleString('pt-BR')}
              </small>
            </div>
          </article>
        ))}
        {!data.versions.length && (
          <p className="compact-empty">Nenhuma versão registrada.</p>
        )}
      </div>
    </section>
  )
}

function CasesCard({
  data,
  busy,
  onCreate,
  onPatch,
}: {
  data: GovernanceData
  busy: string | null
  onCreate: (kind: string, body: Record<string, unknown>) => Promise<void>
  onPatch: (body: Record<string, unknown>) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  async function create(event: FormEvent) {
    event.preventDefault()
    await onCreate('case', {
      title,
      reason,
      priority: 'normal',
      agentId: null,
      contactId: null,
      conversationId: null,
    })
    setTitle('')
    setReason('')
  }
  return (
    <section className="card governance-wide-card">
      <header className="deskcomm-section-header">
        <div>
          <strong>Casos para revisão humana</strong>
          <span>Escalonamentos criados pela operação ou pelos agentes</span>
        </div>
        <ShieldCheck size={19} />
      </header>
      {data.permissions.canOperate && (
        <form
          className="compact-create-form cases-create"
          onSubmit={(event) => void create(event)}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Título do caso"
            required
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo da revisão"
            required
          />
          <button className="button button-outline" disabled={busy === 'case'}>
            <Plus size={15} /> Abrir caso
          </button>
        </form>
      )}
      <div className="case-table table-scroll">
        <table>
          <thead>
            <tr>
              <th>Caso</th>
              <th>Agente</th>
              <th>Prioridade</th>
              <th>Responsável</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  <small>{item.reason}</small>
                </td>
                <td>{item.agentName ?? 'Operação'}</td>
                <td>
                  <StatusDot
                    tone={
                      item.priority === 'urgent' || item.priority === 'high'
                        ? 'orange'
                        : 'gray'
                    }
                  >
                    {priorityLabel(item.priority)}
                  </StatusDot>
                </td>
                <td>{item.assignedName ?? 'Não atribuído'}</td>
                <td>
                  <select
                    aria-label={`Status de ${item.title}`}
                    value={item.status}
                    disabled={!data.permissions.canOperate || busy === item.id}
                    onChange={(event) =>
                      void onPatch({
                        kind: 'case_status',
                        id: item.id,
                        status: event.target.value,
                        assignedTo: item.assigned_to,
                      })
                    }
                  >
                    <option value="open">Aberto</option>
                    <option value="in_progress">Em análise</option>
                    <option value="resolved">Resolvido</option>
                    <option value="dismissed">Descartado</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.cases.length && (
          <p className="compact-empty">
            Nenhum caso aberto ou histórico registrado.
          </p>
        )}
      </div>
    </section>
  )
}

function ExecutionCard({ data }: { data: GovernanceData }) {
  return (
    <section className="card governance-wide-card">
      <header className="deskcomm-section-header">
        <div>
          <strong>Execuções recentes</strong>
          <span>
            {data.provider
              ? `${data.provider.provider} · ${data.provider.model}`
              : 'Provedor pendente'}
          </span>
        </div>
        <Activity size={19} />
      </header>
      <div className="case-table table-scroll">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Agente / finalidade</th>
              <th>Modelo</th>
              <th>Tokens</th>
              <th>Latência</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {data.executions.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.created_at).toLocaleString('pt-BR')}</td>
                <td>
                  <strong>{item.agentName ?? 'Workspace'}</strong>
                  <small>{item.purpose}</small>
                </td>
                <td>
                  {item.provider} · {item.model}
                </td>
                <td>
                  {Number(item.input_tokens) + Number(item.output_tokens)}
                </td>
                <td>{item.latency_ms} ms</td>
                <td>
                  <StatusDot
                    tone={item.status === 'completed' ? 'green' : 'orange'}
                  >
                    {item.status}
                  </StatusDot>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.executions.length && (
          <p className="compact-empty">
            Nenhuma execução registrada neste mês.
          </p>
        )}
      </div>
    </section>
  )
}

function GovernanceStat({
  icon,
  value,
  label,
}: {
  icon: ReactNode
  value: number | string
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
function priorityLabel(priority: string) {
  return (
    { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }[
      priority
    ] ?? priority
  )
}
