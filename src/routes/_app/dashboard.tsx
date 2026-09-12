/** Visão executiva real de Instagram, WhatsApp e CRM nos últimos sete dias. */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Command,
  LoaderCircle,
  Radio,
  Search,
  X,
} from 'lucide-react'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { ComplianceBanner, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import { commandCenterGroups } from '../../lib/app-navigation'

type DashboardData = {
  summary: {
    accountsReached: number
    dmsReceived: number
    dmsSent: number
    comments: number
    newContacts: number
    totalContacts: number
  }
  channels: { instagram: number; whatsapp: number }
  chart: Array<{ day: string; reach: number; messages: number }>
  activity: Array<{
    id: string
    platform: 'instagram' | 'whatsapp'
    title: string
    meta: string
    createdAt: string
  }>
}

export const Route = createFileRoute('/_app/dashboard')({
  component: Dashboard,
})

const number = new Intl.NumberFormat('pt-BR')
const commandToolCount = commandCenterGroups.reduce(
  (total, group) =>
    total + group.items.filter((item) => item.to !== '/dashboard').length,
  0,
)

function normalizeToolSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toolSearch, setToolSearch] = useState('')
  const deferredToolSearch = useDeferredValue(toolSearch)

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<DashboardData>('/api/dashboard'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const stats = data
    ? [
        {
          label: 'Contas alcançadas',
          value: number.format(data.summary.accountsReached),
          detail: 'Instagram · 7 dias',
          tone: 'orange',
        },
        {
          label: 'DMs recebidas',
          value: number.format(data.summary.dmsReceived),
          detail: 'Instagram + WhatsApp',
          tone: 'blue',
        },
        {
          label: 'DMs enviadas',
          value: number.format(data.summary.dmsSent),
          detail: 'Instagram + WhatsApp',
          tone: 'green',
        },
        {
          label: 'Novos contatos',
          value: number.format(data.summary.newContacts),
          detail: `${number.format(data.summary.totalContacts)} no CRM`,
          tone: 'black',
        },
      ]
    : []

  const visibleCommandGroups = useMemo(() => {
    const query = normalizeToolSearch(deferredToolSearch)

    return commandCenterGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.to === '/dashboard') return false
          if (!query) return true

          return normalizeToolSearch(
            `${item.label} ${item.description} ${item.keywords} ${group.title}`,
          ).includes(query)
        }),
      }))
      .filter((group) => group.items.length > 0)
  }, [deferredToolSearch])

  const visibleToolCount = visibleCommandGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  )

  return (
    <div className="stack-xl">
      <section className="welcome-strip">
        <div>
          <span>OPERAÇÃO MULTICANAL</span>
          <h2>Instagram e WhatsApp no mesmo movimento.</h2>
          <p>
            <strong>{data?.channels.instagram ?? 0}</strong> Instagram e{' '}
            <strong>{data?.channels.whatsapp ?? 0}</strong> WhatsApp conectados.
          </p>
        </div>
        <Link to="/operacoes" className="button button-light">
          Ver saúde das integrações <ArrowRight size={16} />
        </Link>
      </section>

      {error && <div className="form-error">{error}</div>}
      {!data && !error && (
        <div className="dashboard-loading">
          <LoaderCircle className="spin" size={18} /> Carregando dados reais…
        </div>
      )}

      <div className="stats-grid">
        {stats.map((stat) => (
          <article className={`stat-card tone-${stat.tone}`} key={stat.label}>
            <span className="stat-label">{stat.label}</span>
            <div>
              <strong>{stat.value}</strong>
            </div>
            <small>{stat.detail}</small>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="card chart-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">MOVIMENTO NOS ÚLTIMOS 7 DIAS</span>
              <h3>Alcance e conversas da operação</h3>
            </div>
            <StatusDot tone="green">Dados reais</StatusDot>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data?.chart ?? []}
                margin={{ top: 12, left: -20, right: 6, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="orangeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f05a28" stopOpacity={0.27} />
                    <stop offset="100%" stopColor="#f05a28" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="#dedbd2"
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: '#79766e' }}
                  tickFormatter={(value) =>
                    new Date(`${String(value)}T12:00:00`).toLocaleDateString(
                      'pt-BR',
                      { day: '2-digit', month: 'short' },
                    )
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: '#111',
                    border: 0,
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="reach"
                  name="Alcance Instagram"
                  stroke="#f05a28"
                  strokeWidth={3}
                  fill="url(#orangeFill)"
                />
                <Area
                  type="monotone"
                  dataKey="messages"
                  name="Interações Meta"
                  stroke="#1d7a55"
                  strokeWidth={2}
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card activity-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">AGORA NO WAL CHAT</span>
              <h3>Movimento recente</h3>
            </div>
            <Radio size={18} />
          </div>
          <div className="activity-list">
            {(data?.activity ?? []).map((item) => (
              <div className="activity-item" key={item.id}>
                <i
                  style={{
                    background:
                      item.platform === 'whatsapp' ? '#1d7a55' : '#f05a28',
                  }}
                />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.meta}</span>
                </div>
                <time>
                  {new Date(item.createdAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            ))}
            {data && !data.activity.length && (
              <div className="table-empty">
                Nenhuma interação nos últimos 7 dias.
              </div>
            )}
          </div>
          <Link to="/inbox" className="inline-link">
            Abrir inbox <ArrowRight size={14} />
          </Link>
        </section>
      </div>

      <section
        className="command-center card"
        aria-labelledby="command-center-title"
      >
        <header className="command-center-head">
          <div className="command-center-intro">
            <span className="eyebrow command-center-eyebrow">
              <Command size={15} aria-hidden="true" /> CENTRAL DE COMANDO
            </span>
            <h3 id="command-center-title">Todas as ferramentas do Wal Chat</h3>
            <p>
              Abra qualquer área do sistema sem precisar percorrer o menu
              lateral.
            </p>
          </div>

          <div className="command-center-search-block">
            <div className="command-center-search">
              <label className="sr-only" htmlFor="dashboard-tool-search">
                Buscar ferramenta
              </label>
              <Search size={18} aria-hidden="true" />
              <input
                id="dashboard-tool-search"
                type="search"
                value={toolSearch}
                onChange={(event) => setToolSearch(event.target.value)}
                placeholder="Buscar ferramenta ou ação..."
                autoComplete="off"
                aria-describedby="dashboard-tool-count"
              />
              {toolSearch && (
                <button
                  type="button"
                  onClick={() => setToolSearch('')}
                  aria-label="Limpar busca de ferramentas"
                >
                  <X size={17} aria-hidden="true" />
                </button>
              )}
            </div>
            <span
              id="dashboard-tool-count"
              className="command-center-count"
              aria-live="polite"
            >
              {toolSearch
                ? `${visibleToolCount} ${visibleToolCount === 1 ? 'resultado' : 'resultados'}`
                : `${commandToolCount} ferramentas`}
            </span>
          </div>
        </header>

        <div className="command-center-groups">
          {visibleCommandGroups.map((group) => (
            <section
              className={`command-group tone-${group.tone}`}
              aria-labelledby={`command-group-${group.id}`}
              key={group.id}
            >
              <header className="command-group-head">
                <div>
                  <span>{group.label}</span>
                  <h4 id={`command-group-${group.id}`}>{group.title}</h4>
                  <p>{group.description}</p>
                </div>
                <strong aria-label={`${group.items.length} ferramentas`}>
                  {group.items.length}
                </strong>
              </header>

              <div className="command-tool-grid">
                {group.items.map((tool) => {
                  const Icon = tool.icon
                  return (
                    <Link
                      to={tool.to}
                      preload="intent"
                      className="command-tool-card"
                      data-command-center-tool
                      key={tool.to}
                    >
                      <span className="command-tool-icon">
                        <Icon size={20} strokeWidth={2} aria-hidden="true" />
                      </span>
                      <span className="command-tool-copy">
                        <strong>{tool.label}</strong>
                        <small>{tool.description}</small>
                      </span>
                      <ArrowRight
                        className="command-tool-arrow"
                        size={17}
                        aria-hidden="true"
                      />
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}

          {visibleToolCount === 0 && (
            <div className="command-center-empty" role="status">
              <Search size={22} aria-hidden="true" />
              <div>
                <strong>Nenhuma ferramenta encontrada</strong>
                <span>Tente buscar por outro nome ou objetivo.</span>
              </div>
              <button type="button" onClick={() => setToolSearch('')}>
                Limpar busca
              </button>
            </div>
          )}
        </div>
      </section>

      <ComplianceBanner />
    </div>
  )
}
