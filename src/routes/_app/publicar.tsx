/** Estúdio persistente com IA real e fila oficial de publicação Instagram. */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Play,
  Save,
  Send,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageIntro } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/publicar')({
  component: PublishPage,
})

type ContentKind = 'feed' | 'reel' | 'story' | 'carousel'
type Media = { url: string; type: 'image' | 'video' }
type ContentItem = {
  id: string
  accountId: string
  kind: ContentKind
  title: string
  caption: string | null
  script: string | null
  media: Media[]
  status: string
  scheduledAt: string | null
  publishedAt: string | null
  errorCode: string | null
}
type ContentData = {
  items: ContentItem[]
  accounts: Array<{
    id: string
    username: string
    accountType: string | null
    canPublish: boolean
  }>
  runtime: { demoMode: boolean; canManage: boolean }
}

const types: Array<{
  name: string
  value: ContentKind
  icon: typeof ImageIcon
}> = [
  { name: 'Feed', value: 'feed', icon: ImageIcon },
  { name: 'Reels', value: 'reel', icon: Play },
  { name: 'Story', value: 'story', icon: Send },
  { name: 'Carrossel', value: 'carousel', icon: LayoutGrid },
]

function serializeMedia(media: Media[]) {
  return media.map((item) => `${item.type}:${item.url}`).join('\n')
}

function parseMedia(value: string): Media[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const explicit = line.match(/^(image|video):(https:\/\/.*)$/i)
      if (explicit)
        return {
          type: explicit[1].toLowerCase() as 'image' | 'video',
          url: explicit[2],
        }
      return {
        type: /\.(mp4|mov)(\?|$)/i.test(line) ? 'video' : 'image',
        url: line,
      }
    })
}

function stripOptOut(value: string) {
  return value.replace(/\s*Responda PARAR\s*$/i, '').trim()
}

function PublishPage() {
  const [data, setData] = useState<ContentData | null>(null)
  const [itemId, setItemId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState('')
  const [kind, setKind] = useState<ContentKind>('carousel')
  const [title, setTitle] = useState('Conteúdo da semana')
  const [briefing, setBriefing] = useState(
    'Por que creator pequeno precisa de uma comunidade forte',
  )
  const [caption, setCaption] = useState('')
  const [script, setScript] = useState('')
  const [mediaText, setMediaText] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [slide, setSlide] = useState(1)
  const [agentId, setAgentId] = useState('')
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)

  const load = useCallback(async () => {
    setBusy('load')
    try {
      const [content, agents] = await Promise.all([
        apiFetch<ContentData>('/api/content'),
        apiFetch<{ agents: Array<{ id: string; isActive: boolean }> }>(
          '/api/ai/agents',
        ),
      ])
      setData(content)
      setAccountId((current) => current || content.accounts[0]?.id || '')
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

  const media = useMemo(() => parseMedia(mediaText), [mediaText])

  function selectItem(item: ContentItem) {
    setItemId(item.id)
    setAccountId(item.accountId)
    setKind(item.kind)
    setTitle(item.title)
    setBriefing(item.title)
    setCaption(item.caption ?? '')
    setScript(item.script ?? '')
    setMediaText(serializeMedia(item.media))
    setScheduledAt(
      item.scheduledAt
        ? new Date(item.scheduledAt).toISOString().slice(0, 16)
        : '',
    )
    setSlide(1)
    setFeedback(
      item.errorCode
        ? { tone: 'error', text: `Falha anterior: ${item.errorCode}` }
        : null,
    )
  }

  async function generate(mode: 'copy' | 'script' | 'slides') {
    if (!agentId) {
      setFeedback({
        tone: 'error',
        text: 'Crie e configure um agente de IA antes de gerar conteúdo.',
      })
      return
    }
    setBusy(`ai-${mode}`)
    try {
      const instruction =
        mode === 'copy'
          ? `Crie uma legenda de Instagram em PT-BR, até 1800 caracteres, sobre: ${briefing}. Inclua gancho, valor prático, CTA e hashtags. Entregue apenas a legenda.`
          : mode === 'script'
            ? `Crie um roteiro objetivo em PT-BR para um ${kind} do Instagram sobre: ${briefing}. Estruture gancho, cenas/blocos, CTA. Entregue apenas o roteiro.`
            : `Crie o texto de 5 slides de carrossel em PT-BR sobre: ${briefing}. Uma linha por slide, numerada de 1 a 5. Entregue apenas os slides.`
      const result = await apiFetch<{ suggestion: string; provider: string }>(
        '/api/ai/suggest',
        {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            history: [{ role: 'user', content: instruction }],
          }),
        },
      )
      const output = stripOptOut(result.suggestion)
      if (mode === 'copy') setCaption(output)
      else setScript(output)
      if (mode === 'slides') setKind('carousel')
      setFeedback({
        tone: 'success',
        text: `Conteúdo gerado via ${result.provider}; revise antes de salvar.`,
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha na IA.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    setBusy('save')
    try {
      const result = await apiFetch<{ id: string }>('/api/content', {
        method: itemId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(itemId ? { id: itemId } : {}),
          accountId,
          kind,
          title,
          caption: caption || null,
          script: script || null,
          media,
        }),
      })
      setItemId(result.id)
      await load()
      setFeedback({ tone: 'success', text: 'Rascunho salvo no backend.' })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function enqueue(action: 'publish' | 'schedule') {
    if (!itemId) {
      setFeedback({ tone: 'error', text: 'Salve o rascunho primeiro.' })
      return
    }
    setBusy(action)
    try {
      const result = await apiFetch<{ scheduledAt: string }>('/api/content', {
        method: 'PUT',
        body: JSON.stringify({
          id: itemId,
          action,
          ...(action === 'schedule'
            ? { scheduledAt: new Date(scheduledAt).toISOString() }
            : {}),
        }),
      })
      await load()
      setFeedback({
        tone: 'success',
        text: `Publicação enfileirada para ${new Date(result.scheduledAt).toLocaleString('pt-BR')}.`,
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao publicar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!itemId || !window.confirm('Excluir este rascunho?')) return
    setBusy('delete')
    try {
      await apiFetch('/api/content', {
        method: 'DELETE',
        body: JSON.stringify({ id: itemId }),
      })
      setItemId(null)
      setCaption('')
      setScript('')
      setMediaText('')
      await load()
      setFeedback({ tone: 'success', text: 'Rascunho excluído.' })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao excluir.',
      })
    } finally {
      setBusy(null)
    }
  }

  const currentAccount = data?.accounts.find(
    (account) => account.id === accountId,
  )
  const canSave = Boolean(
    data?.runtime.canManage &&
    accountId &&
    title.trim() &&
    media.length &&
    !busy,
  )
  return (
    <div className="stack-lg">
      <PageIntro
        title="Do rascunho pro feed."
        description="Gere com IA, persista, agende e publique pela API oficial — sempre com mídia HTTPS validada."
        actions={
          <button
            className="button button-outline"
            onClick={() => {
              setItemId(null)
              setTitle('Novo conteúdo')
              setCaption('')
              setScript('')
              setMediaText('')
              setFeedback(null)
            }}
          >
            Novo conteúdo
          </button>
        }
      />
      {data?.runtime.demoMode && (
        <div className="prototype-notice" role="status">
          <CalendarClock size={20} />
          <div>
            <strong>
              Rascunhos e IA estão ativos; publicação está protegida
            </strong>
            <p>
              Agendar/Publicar só será aceito quando a{' '}
              <Link to="/operacoes">Central de Go-Live</Link> remover o modo
              demo e validar a permissão da Meta.
            </p>
          </div>
        </div>
      )}
      {feedback && (
        <div
          className={feedback.tone === 'error' ? 'form-error' : 'form-success'}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}
      <div className="publish-layout">
        <section className="card publish-form">
          {data && data.items.length > 0 && (
            <label>
              Rascunhos e publicações
              <select
                value={itemId ?? ''}
                onChange={(event) => {
                  const item = data.items.find(
                    (value) => value.id === event.target.value,
                  )
                  if (item) selectItem(item)
                }}
              >
                <option value="">Novo conteúdo</option>
                {data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.status}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="two-fields">
            <label>
              Conta Instagram
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="">Selecione</option>
                {data?.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    @{account.username}
                    {account.canPublish ? '' : ' · sem permissão'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Título interno
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </div>
          <div className="type-picker">
            {types.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.value}
                  className={kind === item.value ? 'active' : ''}
                  onClick={() => setKind(item.value)}
                >
                  <Icon size={18} />
                  {item.name}
                </button>
              )
            })}
          </div>
          <label>
            Tema ou briefing
            <textarea
              value={briefing}
              onChange={(event) => setBriefing(event.target.value)}
            />
          </label>
          <div className="ai-tools">
            <button
              onClick={() => void generate('copy')}
              disabled={Boolean(busy)}
            >
              <Sparkles size={16} /> Gerar copy
            </button>
            <button
              onClick={() => void generate('script')}
              disabled={Boolean(busy)}
            >
              <WandSparkles size={16} /> Criar roteiro
            </button>
            <button
              onClick={() => void generate('slides')}
              disabled={Boolean(busy)}
            >
              <LayoutGrid size={16} /> Gerar slides
            </button>
          </div>
          {busy?.startsWith('ai-') && (
            <div className="generating-line">
              <LoaderCircle className="spin" size={15} /> A IA está criando uma
              versão para revisão…
            </div>
          )}
          <label>
            Legenda
            <textarea
              className="caption-area"
              value={caption}
              maxLength={2200}
              onChange={(event) => setCaption(event.target.value)}
            />
            <small>{caption.length}/2.200</small>
          </label>
          <label>
            Roteiro / textos dos slides
            <textarea
              value={script}
              onChange={(event) => setScript(event.target.value)}
            />
          </label>
          <label>
            Mídias públicas
            <textarea
              value={mediaText}
              onChange={(event) => setMediaText(event.target.value)}
              placeholder="image:https://cdn.exemplo.com/slide-1.jpg&#10;video:https://cdn.exemplo.com/reel.mp4"
            />
            <small>
              Uma por linha. Use image: ou video:. A Meta busca a URL
              diretamente.
            </small>
          </label>
          {kind === 'carousel' && (
            <div className="slides-strip">
              {media.map((item, index) => (
                <button
                  key={`${item.url}-${index}`}
                  onClick={() => setSlide(index + 1)}
                  className={slide === index + 1 ? 'active' : ''}
                >
                  <span>{item.type === 'image' ? 'IMAGEM' : 'VÍDEO'}</span>
                  <em>{index + 1}</em>
                </button>
              ))}
              <button
                className="add-slide"
                onClick={() =>
                  setMediaText(
                    `${mediaText}${mediaText ? '\n' : ''}image:https://`,
                  )
                }
                aria-label="Adicionar mídia ao carrossel"
              >
                +
              </button>
            </div>
          )}
          <div className="publish-actions publish-actions-wrap">
            <button
              className="button button-outline"
              onClick={() => void save()}
              disabled={!canSave}
            >
              {busy === 'save' ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Save size={16} />
              )}{' '}
              Salvar
            </button>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              aria-label="Data de publicação"
            />
            <button
              className="button button-outline"
              onClick={() => void enqueue('schedule')}
              disabled={Boolean(busy) || !itemId || !scheduledAt}
            >
              <CalendarClock size={16} /> Agendar
            </button>
            <button
              className="button button-orange"
              onClick={() => void enqueue('publish')}
              disabled={Boolean(busy) || !itemId}
            >
              <Send size={16} /> Publicar agora
            </button>
            <button
              className="icon-button"
              onClick={() => void remove()}
              disabled={Boolean(busy) || !itemId}
              aria-label="Excluir rascunho"
            >
              <Trash2 size={17} />
            </button>
          </div>
        </section>
        <aside className="preview-column">
          <span className="eyebrow">PREVIEW DO INSTAGRAM</span>
          <div className="instagram-preview">
            <div className="ig-head">
              <span className="avatar avatar-orange">WC</span>
              <strong>
                {currentAccount ? `@${currentAccount.username}` : 'Wal Chat'}
              </strong>
              <em>•••</em>
            </div>
            <div className={`creative-slide slide-${slide}`}>
              {media[slide - 1]?.type === 'image' &&
              media[slide - 1]?.url.startsWith('https://') ? (
                <img
                  src={media[slide - 1].url}
                  alt={`Prévia da mídia ${slide}`}
                />
              ) : (
                <>
                  <span className="urban-line" />
                  <small>WAL CHAT APRESENTA</small>
                  <strong>{briefing || title}</strong>
                  <em>
                    {String(slide).padStart(2, '0')}/
                    {String(Math.max(1, media.length)).padStart(2, '0')}
                  </em>
                </>
              )}
            </div>
            <div className="ig-controls">
              <span>♡ ⌁ ⌯</span>
              <span>{kind}</span>
              <span>▢</span>
            </div>
            <div className="ig-caption">
              <strong>
                {currentAccount ? `@${currentAccount.username}` : 'Wal Chat'}
              </strong>{' '}
              {caption.slice(0, 110)}{' '}
              {caption.length > 110 && <span>mais</span>}
            </div>
          </div>
          <div className="preview-pager">
            <button
              className="icon-button"
              onClick={() => setSlide(Math.max(1, slide - 1))}
              aria-label="Slide anterior"
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              Mídia {Math.min(slide, Math.max(1, media.length))} de{' '}
              {Math.max(1, media.length)}
            </span>
            <button
              className="icon-button"
              onClick={() =>
                setSlide(Math.min(Math.max(1, media.length), slide + 1))
              }
              aria-label="Próxima mídia"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="publish-check">
            <Check size={15} />
            {media.length
              ? `${media.length} mídia(s) pronta(s) para validação`
              : 'Adicione mídia HTTPS para salvar'}
          </div>
        </aside>
      </div>
    </div>
  )
}
