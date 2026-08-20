/** Gestão persistida de gatilhos simples por comentário, DM e story. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  LoaderCircle,
  MessageCircle,
  Plus,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ComplianceBanner, PageIntro, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/gatilhos')({
  component: TriggersPage,
})

type Source = 'comment' | 'dm' | 'story'
type Trigger = {
  id: string
  name: string
  source: Source
  keyword: string
  matchMode: 'exact' | 'contains'
  responseText: string
  cooldownHours: number
  isActive: boolean
  fired: number
}

const initialForm: Omit<Trigger, 'id' | 'fired'> = {
  name: '',
  source: 'comment',
  keyword: '',
  matchMode: 'contains',
  responseText: '',
  cooldownHours: 24,
  isActive: true,
}

function sourceLabel(source: Source) {
  return source === 'comment' ? 'Comentário' : source === 'dm' ? 'DM' : 'Story'
}

function TriggersPage() {
  const [items, setItems] = useState<Trigger[]>([])
  const [filter, setFilter] = useState<'all' | Source>('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [busy, setBusy] = useState<string | null>('load')
  const [error, setError] = useState('')

  const loadTriggers = useCallback(async () => {
    setBusy('load')
    try {
      const result = await apiFetch<{ triggers: Trigger[] }>('/api/triggers')
      setItems(result.triggers)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void loadTriggers()
  }, [loadTriggers])

  const visible = useMemo(
    () => items.filter((item) => filter === 'all' || item.source === filter),
    [filter, items],
  )

  async function createTrigger() {
    setBusy('create')
    try {
      await apiFetch('/api/triggers', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setForm(initialForm)
      setShowForm(false)
      await loadTriggers()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao criar.')
    } finally {
      setBusy(null)
    }
  }

  async function toggleTrigger(trigger: Trigger) {
    try {
      await apiFetch('/api/triggers', {
        method: 'PATCH',
        body: JSON.stringify({ id: trigger.id, isActive: !trigger.isActive }),
      })
      await loadTriggers()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao alterar.')
    }
  }

  async function deleteTrigger(trigger: Trigger) {
    if (!window.confirm(`Excluir o gatilho “${trigger.name}”?`)) return
    try {
      await apiFetch('/api/triggers', {
        method: 'DELETE',
        body: JSON.stringify({ id: trigger.id }),
      })
      await loadTriggers()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao excluir.')
    }
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="Da palavra pra conversa."
        description="Crie o gatilho real; o worker aplica match, cooldown e elegibilidade antes da resposta."
        actions={
          <button
            className="button button-orange"
            onClick={() => setShowForm((value) => !value)}
          >
            <Plus size={16} /> Criar gatilho
          </button>
        }
      />
      <ComplianceBanner compact />
      {error && <div className="form-error">{error}</div>}
      {showForm && (
        <section className="card trigger-editor">
          <div className="two-fields">
            <label>
              Nome
              <input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="Ex.: Guia no comentário"
              />
            </label>
            <label>
              Origem
              <select
                value={form.source}
                onChange={(event) =>
                  setForm({ ...form, source: event.target.value as Source })
                }
              >
                <option value="comment">Comentário</option>
                <option value="dm">DM</option>
                <option value="story">Story</option>
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
                placeholder="quero"
              />
            </label>
            <label>
              Comparação
              <select
                value={form.matchMode}
                onChange={(event) =>
                  setForm({
                    ...form,
                    matchMode: event.target.value as 'exact' | 'contains',
                  })
                }
              >
                <option value="contains">Contém</option>
                <option value="exact">Exata</option>
              </select>
            </label>
          </div>
          <label>
            Resposta automática
            <textarea
              value={form.responseText}
              onChange={(event) =>
                setForm({ ...form, responseText: event.target.value })
              }
              placeholder="Mensagem que será validada e enviada uma única vez."
            />
          </label>
          <div className="trigger-editor-actions">
            <small>
              Cooldown mínimo: 24h. O rodapé “Responda PARAR” é acrescentado
              pelo backend.
            </small>
            <button
              className="button button-dark"
              onClick={() => void createTrigger()}
              disabled={
                busy === 'create' ||
                !form.name.trim() ||
                !form.keyword.trim() ||
                !form.responseText.trim()
              }
            >
              {busy === 'create' ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Zap size={15} />
              )}{' '}
              Salvar gatilho
            </button>
          </div>
        </section>
      )}
      <div className="filter-pills">
        {(
          [
            ['all', 'Todos'],
            ['comment', 'Comentários'],
            ['dm', 'DM'],
            ['story', 'Story'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? 'active' : ''}
            onClick={() => setFilter(value)}
          >
            {label}
            {value === 'all' && <em>{items.length}</em>}
          </button>
        ))}
      </div>
      <section className="trigger-list">
        {busy === 'load' && items.length === 0 && (
          <div className="card inbox-empty">
            <LoaderCircle className="spin" /> Carregando gatilhos…
          </div>
        )}
        {visible.map((trigger) => (
          <article
            className={`card trigger-card ${trigger.isActive ? '' : 'muted'}`}
            key={trigger.id}
          >
            <span className="trigger-source">
              <MessageCircle size={20} />
            </span>
            <div className="trigger-main">
              <div>
                <h3>{trigger.name}</h3>
                <span className="source-chip">
                  {sourceLabel(trigger.source)}
                </span>
              </div>
              <p>
                Quando alguém disser <mark>“{trigger.keyword}”</mark>
              </p>
              <div className="flow-line">
                <Zap size={14} />
                <span>DM: {trigger.responseText}</span>
                <ArrowRight size={14} />
              </div>
            </div>
            <div className="trigger-metrics">
              <strong>{trigger.fired}</strong>
              <small>contatos</small>
            </div>
            <div className="trigger-controls">
              <Switch
                checked={trigger.isActive}
                label={`Ativar ${trigger.name}`}
                onChange={() => void toggleTrigger(trigger)}
              />
              <button
                className="icon-button"
                onClick={() => void deleteTrigger(trigger)}
                aria-label={`Excluir ${trigger.name}`}
              >
                <Trash2 size={18} />
              </button>
            </div>
            <footer>
              <ShieldCheck size={13} /> Cooldown {trigger.cooldownHours}h · 1
              private reply por comentário · opt-out automático
            </footer>
          </article>
        ))}
        {busy !== 'load' && visible.length === 0 && !showForm && (
          <div className="card inbox-empty">Nenhum gatilho nesta origem.</div>
        )}
      </section>
    </div>
  )
}
