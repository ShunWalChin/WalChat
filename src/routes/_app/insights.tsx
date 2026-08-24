/** Painel analítico alimentado por métricas oficiais e eventos locais. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Brain,
  Download,
  ExternalLink,
  Flame,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { PageIntro } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/insights')({
  component: InsightsPage,
})

type Daily = {
  day: string
  reach: number
  views: number
  followers: number
  dmsReceived: number
  dmsSent: number
  comments: number
  newContacts: number
  hourlyActivity: Record<string, number>
}
type InsightsData = {
  daily: Daily[]
  posts: Array<{
    id: string
    caption: string | null
    permalink: string | null
    thumbnailUrl: string | null
    publishedAt: string | null
    reach: number
    views: number
    likes: number
    comments: number
    saves: number
    shares: number
  }>
  accounts: Array<{ id: string; username: string; canSync: boolean }>
  totals: {
    reach: number
    views: number
    dmsReceived: number
    dmsSent: number
    comments: number
    newContacts: number
    followers: number
  }
  generatedAt: string
}

const heatHours = [8, 12, 16, 20, 23]

function percent(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0
}

function InsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [accountId, setAccountId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)

  const load = useCallback(async () => {
    setBusy('load')
    try {
      const [insights, agents] = await Promise.all([
        apiFetch<InsightsData>('/api/insights'),
        apiFetch<{ agents: Array<{ id: string; isActive: boolean }> }>(
          '/api/ai/agents',
        ),
      ])
      setData(insights)
      setAccountId((current) => current || insights.accounts[0]?.id || '')
      setAgentId(
        (current) =>
          current || agents.agents.find((agent) => agent.isActive)?.id || '',
      )
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao carregar.',
      })
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => void load(), [load])

  async function sync() {
    if (!accountId) return
    setBusy('sync')
    try {
      const result = await apiFetch<{ days: number; posts: number }>(
        '/api/insights',
        {
          method: 'POST',
          body: JSON.stringify({ accountId }),
        },
      )
      await load()
      setFeedback({
        tone: 'success',
        text: `${result.days} dias e ${result.posts} posts sincronizados da Meta.`,
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text:
          error instanceof Error ? error.message : 'Falha na sincronização.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function analyze() {
    if (!data || !agentId) {
      setFeedback({
        tone: 'error',
        text: 'Configure um agente de IA para gerar a análise.',
      })
      return
    }
    setBusy('analysis')
    try {
      const result = await apiFetch<{ suggestion: string; provider: string }>(
        '/api/ai/suggest',
        {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            history: [
              {
                role: 'user',
                content: `Analise estes dados reais de Instagram em PT-BR. Dê 3 observações e 3 ações práticas, sem inventar dados. Totais: ${JSON.stringify(data.totals)}. Top posts: ${JSON.stringify(data.posts.slice(0, 5).map((post) => ({ caption: post.caption?.slice(0, 120), reach: post.reach, views: post.views, likes: post.likes, comments: post.comments, saves: post.saves, shares: post.shares })))}`,
              },
            ],
          }),
        },
      )
      setAnalysis(result.suggestion.replace(/\s*Responda PARAR\s*$/i, ''))
      setFeedback({
        tone: 'success',
        text: `Análise gerada via ${result.provider}.`,
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha na análise.',
      })
    } finally {
      setBusy(null)
    }
  }

  function exportCsv() {
    if (!data) return
    const rows = [
      [
        'data',
        'alcance',
        'visualizacoes',
        'seguidores',
        'dms_recebidas',
        'dms_enviadas',
        'comentarios',
        'novos_contatos',
      ],
      ...data.daily.map((day) => [
        day.day,
        day.reach,
        day.views,
        day.followers,
        day.dmsReceived,
        day.dmsSent,
        day.comments,
        day.newContacts,
      ]),
    ]
    const csv = rows.map((row) => row.join(';')).join('\n')
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `wal-chat-insights-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setFeedback({ tone: 'success', text: 'Relatório CSV exportado.' })
  }

  const chartData =
    data?.daily.map((day) => ({
      day: new Date(`${day.day}T12:00:00`).toLocaleDateString('pt-BR', {
        weekday: 'short',
      }),
      dms: day.dmsReceived,
      contatos: day.newContacts,
    })) ?? []
  const heatmap = useMemo(() => {
    const values = heatHours.flatMap((hour) =>
      Array.from({ length: 7 }, (_, weekday) => {
        const total =
          data?.daily
            .filter(
              (day) => new Date(`${day.day}T12:00:00`).getDay() === weekday,
            )
            .reduce((sum, day) => {
              const activity = day.hourlyActivity
              return (
                sum +
                Object.entries(activity)
                  .filter(([key]) => Math.abs(Number(key) - hour) <= 1)
                  .reduce((bucket, [, value]) => bucket + Number(value), 0)
              )
            }, 0) ?? 0
        return total
      }),
    )
    const max = Math.max(1, ...values)
    return values.map((value) => Math.round((value / max) * 100))
  }, [data])
  const bestHeat = Math.max(0, ...heatmap)
  const responseRate = percent(
    data?.totals.dmsSent ?? 0,
    data?.totals.dmsReceived ?? 0,
  )
  const conversion = percent(
    data?.totals.newContacts ?? 0,
    data?.totals.dmsReceived ?? 0,
  )

  return (
    <div className="stack-lg">
      <PageIntro
        title="O que bombou — e por quê."
        description="Métricas oficiais da Meta combinadas com DMs, comentários e contatos do Wal Chat."
        actions={
          <>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              aria-label="Conta de insights"
            >
              <option value="">Selecione a conta</option>
              {data?.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  @{account.username}
                  {account.canSync ? '' : ' · sem permissão'}
                </option>
              ))}
            </select>
            <button
              className="button button-dark"
              onClick={() => void sync()}
              disabled={Boolean(busy) || !accountId}
            >
              {busy === 'sync' ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}{' '}
              Sincronizar Meta
            </button>
            <button
              className="button button-outline"
              onClick={exportCsv}
              disabled={!data?.daily.length}
            >
              <Download size={16} /> Exportar relatório
            </button>
          </>
        }
      />
      {feedback && (
        <div
          className={feedback.tone === 'error' ? 'form-error' : 'form-success'}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}
      <div className="insight-stats">
        <article>
          <span>SEGUIDORES</span>
          <strong>
            {data?.totals.followers.toLocaleString('pt-BR') ?? '—'}
          </strong>
          <em>
            <ArrowUpRight size={14} /> {data?.totals.reach ?? 0} alcançados
          </em>
        </article>
        <article>
          <span>TAXA DE RESPOSTA</span>
          <strong>{responseRate}%</strong>
          <em>
            <ArrowUpRight size={14} /> {data?.totals.dmsSent ?? 0} respostas
          </em>
        </article>
        <article>
          <span>CONVERSÃO DE DM</span>
          <strong>{conversion}%</strong>
          <em>
            <ArrowUpRight size={14} /> {data?.totals.newContacts ?? 0} contatos
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
            <span className="source-chip">{chartData.length} dias</span>
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
                <Bar dataKey="contatos" fill="#1d7d5c" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card ai-analysis">
          <span className="analysis-icon">
            <Brain size={22} />
          </span>
          <span className="eyebrow">ANÁLISE COM IA</span>
          <h3>
            {analysis
              ? 'Leitura baseada nos seus dados'
              : 'Pronta para analisar'}
          </h3>
          <p className="analysis-copy">
            {analysis ||
              'Sincronize as métricas e peça uma análise. O prompt recebe apenas totais e desempenho dos posts, nunca tokens ou dados privados.'}
          </p>
          <button
            className="button button-dark"
            onClick={() => void analyze()}
            disabled={Boolean(busy) || !data?.daily.length}
          >
            {busy === 'analysis' ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Sparkles size={15} />
            )}{' '}
            Analisar com IA
          </button>
          <div>
            <span>
              <Flame size={15} /> Gancho
            </span>
            <span>
              <Sparkles size={15} /> CTA
            </span>
            <span>
              <Trophy size={15} /> Tema
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
            <strong>{bestHeat ? 'Com atividade real' : 'Sem dados'}</strong>
          </div>
          <div className="heatmap">
            <div className="heat-labels vertical">
              {heatHours.map((hour) => (
                <span key={hour}>{hour}h</span>
              ))}
            </div>
            <div className="heat-cells">
              {heatmap.map((value, index) => (
                <i
                  key={index}
                  style={{ opacity: Math.max(0.16, value / 100) }}
                  title={`${value}% da atividade máxima`}
                />
              ))}
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
              <h3>O pódio do período</h3>
            </div>
          </div>
          {data?.posts.slice(0, 5).map((post, index) => (
            <div className="top-post" key={post.id}>
              <em>{String(index + 1).padStart(2, '0')}</em>
              <span>
                <strong>
                  {post.caption?.slice(0, 80) || 'Post sem legenda'}
                </strong>
                <small>{post.reach.toLocaleString('pt-BR')} alcançados</small>
              </span>
              <b>{post.views.toLocaleString('pt-BR')} views</b>
              {post.permalink && (
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Abrir post no Instagram"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          ))}
          {data && data.posts.length === 0 && (
            <div className="inbox-empty">Nenhum post sincronizado.</div>
          )}
        </section>
      </div>
    </div>
  )
}
