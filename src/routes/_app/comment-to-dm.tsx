/** Campanhas Comment-to-DM ligadas a posts reais, gatilhos e Private Replies. */
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  Instagram,
  LoaderCircle,
  MessageCircleReply,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageIntro, StatusDot, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/comment-to-dm')({
  component: CommentToDmPage,
})

type MetaStatus = {
  accounts: Array<{
    id: string
    username: string
    status: string
    tokenStored: boolean
  }>
}
type MetaPost = {
  id: string
  instagram_account_id: string
  instagram_media_id: string
  kind: 'feed' | 'reel' | 'carousel'
  caption: string | null
  permalink: string | null
  media_url: string | null
  thumbnail_url: string | null
  published_at: string | null
}
type CommentTrigger = {
  id: string
  name: string
  source: 'comment' | 'dm' | 'story'
  keyword: string
  matchMode: 'exact' | 'contains'
  responseText: string
  postId: string | null
  cooldownHours: number
  isActive: boolean
  fired: number
  sent: number
  failed: number
}
type GoLiveStatus = {
  settings: { externalSendsEnabled: boolean; commentToDmEnabled: boolean }
}

type CommentToDmForm = {
  name: string
  postId: string
  keyword: string
  matchMode: 'exact' | 'contains'
  responseText: string
  cooldownHours: number
}

const initialForm: CommentToDmForm = {
  name: 'Comentário para DM',
  postId: '',
  keyword: 'quero',
  matchMode: 'contains' as const,
  responseText: 'Boa! Te mandei os detalhes por aqui.',
  cooldownHours: 24,
}

function CommentToDmPage() {
  const [posts, setPosts] = useState<MetaPost[]>([])
  const [triggers, setTriggers] = useState<CommentTrigger[]>([])
  const [account, setAccount] = useState<MetaStatus['accounts'][number] | null>(
    null,
  )
  const [goLive, setGoLive] = useState<GoLiveStatus | null>(null)
  const [form, setForm] = useState(initialForm)
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<{
    tone: 'error' | 'success'
    text: string
  } | null>(null)

  const load = useCallback(async () => {
    setBusy('load')
    try {
      const [meta, media, triggerResult, live] = await Promise.all([
        apiFetch<MetaStatus>('/api/integrations/meta/status'),
        apiFetch<{ posts: MetaPost[] }>('/api/integrations/meta/media'),
        apiFetch<{ triggers: CommentTrigger[] }>('/api/triggers'),
        apiFetch<GoLiveStatus>('/api/operations/go-live'),
      ])
      setAccount(
        meta.accounts.find(
          (item) => item.status === 'connected' && item.tokenStored,
        ) ?? null,
      )
      setPosts(media.posts)
      setTriggers(
        triggerResult.triggers.filter(
          (trigger) => trigger.source === 'comment',
        ),
      )
      setGoLive(live)
      setFeedback(null)
    } catch (error) {
      setFeedback({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Falha ao abrir o Comment-to-DM.',
      })
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectedPost = posts.find((post) => post.id === form.postId) ?? null
  const totals = useMemo(
    () =>
      triggers.reduce(
        (sum, trigger) => ({
          fired: sum.fired + trigger.fired,
          sent: sum.sent + trigger.sent,
          failed: sum.failed + trigger.failed,
        }),
        { fired: 0, sent: 0, failed: 0 },
      ),
    [triggers],
  )

  async function syncPosts() {
    if (!account) return
    setBusy('sync')
    try {
      const result = await apiFetch<{ synced: number }>(
        '/api/integrations/meta/media',
        {
          method: 'POST',
          body: JSON.stringify({ accountId: account.id }),
        },
      )
      setFeedback({
        tone: 'success',
        text: `${result.synced} publicação(ões) sincronizadas.`,
      })
      await load()
    } catch (error) {
      setFeedback({
        tone: 'error',
        text:
          error instanceof Error ? error.message : 'Falha na sincronização.',
      })
      setBusy(null)
    }
  }

  async function createTrigger() {
    setBusy('create')
    try {
      await apiFetch('/api/triggers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          source: 'comment',
          keyword: form.keyword,
          matchMode: form.matchMode,
          responseText: form.responseText,
          postId: form.postId || null,
          cooldownHours: form.cooldownHours,
          isActive: true,
        }),
      })
      setForm(initialForm)
      setFeedback({ tone: 'success', text: 'Regra Comment-to-DM criada.' })
      await load()
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao criar regra.',
      })
      setBusy(null)
    }
  }

  async function toggleTrigger(trigger: CommentTrigger) {
    setBusy(`toggle-${trigger.id}`)
    try {
      await apiFetch('/api/triggers', {
        method: 'PATCH',
        body: JSON.stringify({ id: trigger.id, isActive: !trigger.isActive }),
      })
      await load()
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao atualizar.',
      })
      setBusy(null)
    }
  }

  async function removeTrigger(triggerId: string) {
    if (!window.confirm('Excluir esta regra de Comment-to-DM?')) return
    setBusy(`delete-${triggerId}`)
    try {
      await apiFetch('/api/triggers', {
        method: 'DELETE',
        body: JSON.stringify({ id: triggerId }),
      })
      await load()
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao excluir.',
      })
      setBusy(null)
    }
  }

  const ready = Boolean(
    account &&
    goLive?.settings.externalSendsEnabled &&
    goLive.settings.commentToDmEnabled,
  )
  return (
    <div className="stack-lg">
      <PageIntro
        title="Do comentário para a conversa."
        description="Escolha um post real, reconheça a palavra-chave e envie uma única Private Reply elegível."
        actions={
          <button
            className="button button-outline"
            onClick={() => void syncPosts()}
            disabled={!account || Boolean(busy)}
          >
            {busy === 'sync' ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            Sincronizar posts
          </button>
        }
      />
      {feedback && (
        <div
          className={feedback.tone === 'error' ? 'form-error' : 'form-success'}
          role="status"
        >
          {feedback.tone === 'error' ? (
            <AlertTriangle size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          {feedback.text}
        </div>
      )}
      <div className={`comment-dm-readiness ${ready ? 'ready' : ''}`}>
        <ShieldCheck size={21} />
        <div>
          <strong>{ready ? 'Canal liberado' : 'Canal protegido'}</strong>
          <p>
            {ready
              ? `@${account?.username} está conectado e o kill switch está ativo.`
              : 'Conecte a Meta e libere External Sends + Comment-to-DM na Central de Go-Live.'}
          </p>
        </div>
        <a className="button button-dark" href="/operacoes">
          Abrir Go-Live
        </a>
      </div>

      <div className="comment-dm-layout">
        <section className="card comment-dm-builder">
          <div className="card-head">
            <div>
              <span className="eyebrow">NOVA REGRA</span>
              <h3>Configurar Private Reply</h3>
            </div>
            <MessageCircleReply size={21} />
          </div>
          <div className="two-fields">
            <label>
              Nome da regra
              <input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
            <label>
              Publicação
              <select
                value={form.postId}
                onChange={(event) =>
                  setForm({ ...form, postId: event.target.value })
                }
              >
                <option value="">Qualquer publicação</option>
                {posts.map((post) => (
                  <option key={post.id} value={post.id}>
                    {post.kind.toUpperCase()} ·{' '}
                    {(post.caption ?? 'Sem legenda').slice(0, 55)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two-fields">
            <label>
              Palavra-chave
              <input
                value={form.keyword}
                onChange={(event) =>
                  setForm({ ...form, keyword: event.target.value })
                }
              />
            </label>
            <label>
              Correspondência
              <select
                value={form.matchMode}
                onChange={(event) =>
                  setForm({
                    ...form,
                    matchMode: event.target.value as 'exact' | 'contains',
                  })
                }
              >
                <option value="contains">Contém a palavra</option>
                <option value="exact">Comentário exato</option>
              </select>
            </label>
          </div>
          <label>
            Mensagem privada automática
            <textarea
              value={form.responseText}
              onChange={(event) =>
                setForm({ ...form, responseText: event.target.value })
              }
              maxLength={900}
            />
            <small>
              O gateway acrescenta “Responda PARAR” e limita o total a 1.000
              caracteres.
            </small>
          </label>
          <label>
            Cooldown por contato
            <select
              value={form.cooldownHours}
              onChange={(event) =>
                setForm({ ...form, cooldownHours: Number(event.target.value) })
              }
            >
              <option value={24}>24 horas</option>
              <option value={48}>48 horas</option>
              <option value={72}>72 horas</option>
              <option value={168}>7 dias</option>
            </select>
          </label>
          <button
            className="button button-orange button-full"
            onClick={() => void createTrigger()}
            disabled={
              !form.name.trim() ||
              !form.keyword.trim() ||
              !form.responseText.trim() ||
              Boolean(busy)
            }
          >
            <Send size={16} /> Criar regra protegida
          </button>
        </section>

        <aside className="card instagram-preview-card">
          <div className="preview-post-media">
            {selectedPost?.thumbnail_url || selectedPost?.media_url ? (
              <img
                src={selectedPost.thumbnail_url ?? selectedPost.media_url ?? ''}
                alt="Prévia da publicação selecionada"
              />
            ) : (
              <Instagram size={38} />
            )}
          </div>
          <div className="preview-post-copy">
            <strong>@{account?.username ?? 'instagram'}</strong>
            <p>{selectedPost?.caption ?? 'Qualquer publicação da conta'}</p>
          </div>
          <div className="comment-example">
            <span>Seguidor</span>
            <p>{form.keyword || 'quero'}</p>
          </div>
          <div className="dm-example">
            <MessageCircleReply size={16} />
            <p>
              {form.responseText || 'Sua mensagem privada'}
              <br />
              <br /> Responda PARAR
            </p>
          </div>
          <small>Preview. Nenhuma mensagem é enviada pelo editor.</small>
        </aside>
      </div>

      <section className="card comment-rules">
        <div className="card-head">
          <div>
            <span className="eyebrow">REGRAS ATIVAS</span>
            <h3>Performance do Comment-to-DM</h3>
          </div>
          <StatusDot tone={ready ? 'green' : 'orange'}>
            {totals.sent} enviadas · {totals.failed} bloqueadas/falhas
          </StatusDot>
        </div>
        <div className="comment-rule-list">
          {triggers.map((trigger) => {
            const post = posts.find((item) => item.id === trigger.postId)
            return (
              <article key={trigger.id}>
                <span className="comment-rule-icon">
                  <MessageCircleReply size={18} />
                </span>
                <div>
                  <strong>{trigger.name}</strong>
                  <p>
                    “{trigger.keyword}” ·{' '}
                    {post
                      ? `${post.kind} ${post.instagram_media_id}`
                      : 'qualquer post'}
                  </p>
                </div>
                <span className="comment-rule-metric">
                  <strong>{trigger.fired}</strong> matches
                </span>
                <span className="comment-rule-metric">
                  <strong>{trigger.sent}</strong> enviadas
                </span>
                <Switch
                  checked={trigger.isActive}
                  label={`Ativar ${trigger.name}`}
                  onChange={() => void toggleTrigger(trigger)}
                />
                <button
                  className="icon-button"
                  onClick={() => void removeTrigger(trigger.id)}
                  aria-label={`Excluir ${trigger.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            )
          })}
          {busy !== 'load' && triggers.length === 0 && (
            <div className="table-empty">
              Nenhuma regra de comentário criada ainda.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
