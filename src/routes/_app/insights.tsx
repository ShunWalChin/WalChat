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
import { PageIntro, PrototypeNotice } from '../../components/ui'

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
          <button className="button button-outline" disabled>
            <Download size={16} /> Exportar relatório
          </button>
        }
      />
      <PrototypeNotice title="Insights aguardam sincronização oficial">
        Alcance, seguidores, heatmap, posts e análise só serão exibidos após a
        ingestão autorizada das métricas da conta Meta conectada.
      </PrototypeNotice>
      <div className="insight-stats">
        <article>
          <span>SEGUIDORES</span>
          <strong>—</strong>
          <em>
            <ArrowUpRight size={14} />
            Aguardando dados
          </em>
        </article>
        <article>
          <span>TAXA DE RESPOSTA</span>
          <strong>—</strong>
          <em>
            <ArrowUpRight size={14} />
            Aguardando dados
          </em>
        </article>
        <article>
          <span>CONVERSÃO DE DM</span>
          <strong>—</strong>
          <em>
            <ArrowUpRight size={14} />
            Aguardando dados
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
              <BarChart data={[]} margin={{ top: 10, left: -25, right: 5 }}>
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
          <h3>Análise ainda não calculada</h3>
          <p>
            Conecte uma conta, sincronize métricas e escolha o período. A
            análise será gerada apenas a partir dos dados reais autorizados.
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
            <strong>Sem dados</strong>
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
              {Array.from({ length: 5 }, () => Array(7).fill(0)).flatMap(
                (row, rowIndex) =>
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
          {[['—', 'Nenhum post sincronizado', '—', '—']].map((post) => (
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
