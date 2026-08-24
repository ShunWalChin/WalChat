/** Configuração persistente e diagnóstico honesto da capacidade de auto-like. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Brain,
  CheckCircle2,
  ExternalLink,
  Heart,
  LoaderCircle,
  MessageCircle,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ComplianceBanner, PageIntro, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/auto-like')({
  component: AutoLikePage,
})

type Mode = 'all' | 'positive' | 'keyword'
type AutoLikeData = {
  settings: {
    mode: Mode
    keywords: string[]
    requestedEnabled: boolean
    capabilitySupported: boolean
    effectiveEnabled: boolean
    updatedAt: string | null
  }
  activity: { commentsToday: number; likesExecuted: number }
  capability: {
    code: string
    explanation: string
    officialDocumentation: string
  }
  permissions: { canManage: boolean }
}

const modes = [
  {
    id: 'all' as const,
    title: 'Tudo que chegar',
    text: 'Preferência para comentários fora da blocklist.',
    icon: Heart,
  },
  {
    id: 'positive' as const,
    title: 'Só sentimento positivo',
    text: 'Preferência para classificação positiva por IA.',
    icon: Brain,
  },
  {
    id: 'keyword' as const,
    title: 'Só palavra-gatilho',
    text: 'Preferência quando houver uma das palavras configuradas.',
    icon: Sparkles,
  },
]

function AutoLikePage() {
  const [data, setData] = useState<AutoLikeData | null>(null)
  const [requestedEnabled, setRequestedEnabled] = useState(false)
  const [mode, setMode] = useState<Mode>('positive')
  const [keywords, setKeywords] = useState('quero, link, preço, valor, aula')
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)

  const load = useCallback(async () => {
    setBusy('load')
    try {
      const result = await apiFetch<AutoLikeData>('/api/auto-like')
      setData(result)
      setRequestedEnabled(result.settings.requestedEnabled)
      setMode(result.settings.mode)
      setKeywords(result.settings.keywords.join(', '))
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

  async function save(nextEnabled = requestedEnabled) {
    setBusy('save')
    try {
      const result = await apiFetch<{
        warning: string | null
        effectiveEnabled: boolean
      }>('/api/auto-like', {
        method: 'PUT',
        body: JSON.stringify({
          mode,
          requestedEnabled: nextEnabled,
          keywords: keywords
            .split(',')
            .map((keyword) => keyword.trim())
            .filter(Boolean),
        }),
      })
      setRequestedEnabled(nextEnabled)
      await load()
      setFeedback({
        tone: result.warning ? 'error' : 'success',
        text:
          result.warning ??
          'Configuração salva. Nenhuma ação externa foi executada.',
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="Dá moral sem perder a mão."
        description="Prepare as regras de reconhecimento sem usar automação não autorizada pela Meta."
        actions={
          <span className="master-switch">
            <span>
              <strong>Preferência de auto-like</strong>
              <small>
                {data?.settings.effectiveEnabled
                  ? 'Em execução'
                  : 'API oficial sem essa capacidade'}
              </small>
            </span>
            <Switch
              checked={requestedEnabled}
              disabled={!data?.permissions.canManage || Boolean(busy)}
              label="Preparar auto-like"
              onChange={() => void save(!requestedEnabled)}
            />
          </span>
        }
      />
      <div className="prototype-notice" role="status">
        <ShieldCheck size={20} />
        <div>
          <strong>Limite confirmado na API oficial</strong>
          <p>
            {data?.capability.explanation ??
              'Consultando a capacidade oficial da Meta.'}{' '}
            {data?.capability.officialDocumentation && (
              <a
                href={data.capability.officialDocumentation}
                target="_blank"
                rel="noreferrer"
              >
                Ver documentação <ExternalLink size={12} />
              </a>
            )}
          </p>
        </div>
      </div>
      <ComplianceBanner compact />
      {feedback && (
        <div
          className={feedback.tone === 'error' ? 'form-error' : 'form-success'}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}
      <div className="auto-like-layout">
        <section className="card modes-card">
          <span className="eyebrow">PREFERÊNCIA PREPARADA</span>
          <div className="mode-options">
            {modes.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={mode === item.id ? 'active' : ''}
                  onClick={() => setMode(item.id)}
                >
                  <span className="radio-circle">
                    {mode === item.id && <i />}
                  </span>
                  <span className="mode-icon">
                    <Icon size={20} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </div>
                  <em>Configurável</em>
                </button>
              )
            })}
          </div>
          <div className="keyword-config">
            <label>
              Palavras-gatilho
              <input
                value={keywords}
                onChange={(event) => setKeywords(event.target.value)}
              />
            </label>
            <small>Separe por vírgula. Acentos e caixa são normalizados.</small>
          </div>
          <button
            className="button button-dark"
            onClick={() => void save()}
            disabled={Boolean(busy) || !data?.permissions.canManage}
          >
            {busy === 'save' ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Save size={15} />
            )}{' '}
            Salvar configuração
          </button>
        </section>
        <aside className="card like-activity">
          <span className="eyebrow">HOJE</span>
          <h3>Atividade observada</h3>
          <div className="like-ring">
            <span>
              <strong>{data?.activity.commentsToday ?? 0}</strong>
              <small>comentários</small>
            </span>
          </div>
          <div className="like-breakdown">
            <span>
              <CheckCircle2 size={15} /> Curtidas executadas{' '}
              <strong>{data?.activity.likesExecuted ?? 0}</strong>
            </span>
            <span>
              <MessageCircle size={15} /> Comentários recebidos{' '}
              <strong>{data?.activity.commentsToday ?? 0}</strong>
            </span>
            <span>
              <ShieldCheck size={15} /> Ações não oficiais <strong>0</strong>
            </span>
          </div>
          <p className="ai-insight">
            <Brain size={17} />
            <span>
              <strong>Decisão de segurança</strong>O Wal Chat não usa endpoint
              privado, automação de navegador ou token de usuário para simular
              curtidas.
            </span>
          </p>
        </aside>
      </div>
    </div>
  )
}
