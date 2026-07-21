/** Visão executiva dos últimos sete dias, atividade e atalhos operacionais. */
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Bot, Radio, Sparkles, Users, Zap } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { activity, chartData, overviewStats } from '../../lib/demo-data'
import { ComplianceBanner, StatusDot } from '../../components/ui'

export const Route = createFileRoute('/_app/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  return (
    <div className="stack-xl">
      <section className="welcome-strip">
        <div>
          <span>FALA, WAL DEMO 👊</span>
          <h2>Seu Instagram tá no movimento.</h2>
          <p>
            Os últimos 7 dias renderam <strong>235 novos contatos</strong> e 374
            conversas.
          </p>
        </div>
        <Link to="/insights" className="button button-light">
          Ver relatório completo <ArrowRight size={16} />
        </Link>
      </section>

      <div className="stats-grid">
        {overviewStats.map((stat) => (
          <article className={`stat-card tone-${stat.tone}`} key={stat.label}>
            <span className="stat-label">{stat.label}</span>
            <div>
              <strong>{stat.value}</strong>
              <em>{stat.change}</em>
            </div>
            <small>vs. 7 dias anteriores</small>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="card chart-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">ALCANCE NOS ÚLTIMOS 7 DIAS</span>
              <h3>Crescendo na rua e no feed</h3>
            </div>
            <StatusDot tone="green">Ao vivo</StatusDot>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
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
                />
                <Tooltip
                  contentStyle={{
                    background: '#111',
                    border: 0,
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 12,
                  }}
                  formatter={(value) => [`${value} mil`, 'Alcance']}
                />
                <Area
                  type="monotone"
                  dataKey="reach"
                  stroke="#f05a28"
                  strokeWidth={3}
                  fill="url(#orangeFill)"
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
            {activity.map((item) => (
              <div className="activity-item" key={item.title}>
                <i style={{ background: item.color }} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.meta}</span>
                </div>
                <time>{item.time}</time>
              </div>
            ))}
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
            <small>Transforme comentário em conversa</small>
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
        <Link to="/reengajamento" className="quick-card">
          <span className="quick-icon green">
            <Users size={21} />
          </span>
          <div>
            <strong>Reengajar contatos</strong>
            <small>235 pessoas elegíveis</small>
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
