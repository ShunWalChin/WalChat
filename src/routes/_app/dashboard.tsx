/** Visão executiva real de Instagram, WhatsApp e CRM nos últimos sete dias. */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Bot,
  LoaderCircle,
  Radio,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="stack-xl">
      <section className="welcome-strip">
        <div>
          <span>OPERAÇÃO MULTICANAL 👊</span>
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

      <section className="quick-grid">
        <Link to="/gatilhos" className="quick-card">
          <span className="quick-icon orange">
            <Zap size={21} />
          </span>
          <div>
            <strong>Novo gatilho</strong>
            <small>Instagram, story ou WhatsApp</small>
          </div>
          <ArrowRight size={18} />
        </Link>
        <Link to="/agentes" className="quick-card">
          <span className="quick-icon blue">
            <Bot size={21} />
          </span>
          <div>
            <strong>Treinar agente</strong>
            <small>Dê mais contexto para a IA</small>
          </div>
          <ArrowRight size={18} />
        </Link>
        <Link to="/contatos" className="quick-card">
          <span className="quick-icon green">
            <Users size={21} />
          </span>
          <div>
            <strong>Ver contatos</strong>
            <small>Elegibilidade por canal em tempo real</small>
          </div>
          <ArrowRight size={18} />
        </Link>
        <Link to="/publicar" className="quick-card">
          <span className="quick-icon dark">
            <Sparkles size={21} />
          </span>
          <div>
            <strong>Criar com IA</strong>
            <small>Roteiro, copy e carrossel</small>
          </div>
          <ArrowRight size={18} />
        </Link>
      </section>

      <ComplianceBanner />
    </div>
  )
}
