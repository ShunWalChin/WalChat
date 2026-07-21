/** Painel analítico com crescimento, heatmap, top posts e leitura em PT-BR. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Brain,
  Download,
  Flame,
  Sparkles,
  Trophy,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { chartData, heatmap } from '../../lib/demo-data'
import { PageIntro } from '../../components/ui'

export const Route = createFileRoute('/_app/insights')({
  component: InsightsPage,
})

function InsightsPage() {
  return (
    <div className="stack-lg">
      <PageIntro
        title="O que bombou — e por quê."
        description="Crescimento, melhores horários e leitura da IA em português claro."
        actions={
          <button className="button button-outline">
            <Download size={16} /> Exportar relatório
          </button>
        }
      />
      <div className="insight-stats">
        <article>
          <span>SEGUIDORES</span>
          <strong>18.552</strong>
          <em>
            <ArrowUpRight size={14} />
            +332 esta semana
          </em>
        </article>
        <article>
          <span>TAXA DE RESPOSTA</span>
          <strong>91,4%</strong>
          <em>
            <ArrowUpRight size={14} />
            +4,2 p.p.
          </em>
        </article>
        <article>
          <span>CONVERSÃO DE DM</span>
          <strong>38,7%</strong>
          <em>
            <ArrowUpRight size={14} />
            +6,1 p.p.
          </em>
        </article>
      </div>
      <div className="insights-main-grid">
        <section className="card chart-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">CONTATOS GERADOS</span>
              <h3>Conversa puxando crescimento</h3>
            </div>
            <span className="source-chip">7 dias</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, left: -25, right: 5 }}
              >
                <CartesianGrid
                  stroke="#dedbd2"
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#79766e' }}
                />
                <Tooltip
                  contentStyle={{
                    background: '#111',
                    border: 0,
                    borderRadius: 10,
                    color: '#fff',
                  }}
                />
                <Bar dataKey="dms" fill="#f05a28" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card ai-analysis">
          <span className="analysis-icon">
            <Brain size={22} />
          </span>
          <span className="eyebrow">ANÁLISE DO GEMINI</span>
          <h3>Por que o post bombou?</h3>
          <p>
            O Reel abriu com uma dor específica nos primeiros 2 segundos e
            entregou prova visual antes da explicação. O CTA “comenta QUERO”
            teve baixa fricção e transformou alcance em{' '}
            <strong>148 conversas</strong>.
          </p>
          <div>
            <span>
              <Flame size={15} />
              Gancho forte
            </span>
            <span>
              <Sparkles size={15} />
              CTA simples
            </span>
            <span>
              <Trophy size={15} />
              Tema recorrente
            </span>
          </div>
        </section>
      </div>
      <div className="insights-bottom-grid">
        <section className="card heatmap-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">MELHOR HORÁRIO</span>
              <h3>Quando sua galera aparece</h3>
            </div>
            <strong>Sex · 20h</strong>
          </div>
          <div className="heatmap">
            <div className="heat-labels vertical">
              <span>8h</span>
              <span>12h</span>
              <span>16h</span>
              <span>20h</span>
              <span>23h</span>
            </div>
            <div className="heat-cells">
              {heatmap.flatMap((row, rowIndex) =>
                row.map((value, colIndex) => (
                  <i
                    key={`${rowIndex}-${colIndex}`}
                    style={{ opacity: Math.max(0.16, value / 100) }}
                    title={`${value}% de atividade`}
                  />
                )),
              )}
            </div>
            <div className="heat-labels horizontal">
              {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
          </div>
        </section>
        <section className="card top-posts">
          <div className="card-head">
            <div>
              <span className="eyebrow">TOP POSTS</span>
              <h3>O pódio da semana</h3>
            </div>
          </div>
          {[
            ['01', '3 erros de creator', '18,2 mil', '148 DMs'],
            ['02', 'Bastidores no Centro', '13,7 mil', '91 DMs'],
            ['03', 'Setup de R$ 300', '12,1 mil', '72 DMs'],
          ].map((post) => (
            <div className="top-post" key={post[0]}>
              <em>{post[0]}</em>
              <span>
                <strong>{post[1]}</strong>
                <small>{post[2]} contas alcançadas</small>
              </span>
              <b>{post[3]}</b>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
