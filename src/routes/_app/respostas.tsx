/** Biblioteca de respostas rápidas pessoais e compartilhadas. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Copy,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageIntro, StatusDot, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import './deskcomm.css'

type Template = {
  id: string
  title: string
  body: string
  shortcut: string | null
  category: string
  use_count: number
  shared: boolean
  canEdit: boolean
  updated_at: string
}
type TemplatesData = {
  templates: Template[]
  permissions: { canCreate: boolean; canShare: boolean }
}

export const Route = createFileRoute('/_app/respostas')({
  component: TemplatesPage,
})

function TemplatesPage() {
  const [data, setData] = useState<TemplatesData | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await apiFetch<TemplatesData>('/api/templates'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => void load(), [load])

  const templates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalized) return data?.templates ?? []
    return (data?.templates ?? []).filter((template) =>
      [
        template.title,
        template.body,
        template.shortcut,
        template.category,
      ].some((value) => value?.toLocaleLowerCase('pt-BR').includes(normalized)),
    )
  }, [data?.templates, query])

  async function remove(template: Template) {
    if (!window.confirm(`Remover a resposta “${template.title}”?`)) return
    try {
      await apiFetch(`/api/templates/${template.id}`, { method: 'DELETE' })
      setFeedback('Resposta rápida removida.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao remover.')
    }
  }

  async function copy(template: Template) {
    await navigator.clipboard.writeText(template.body)
    setFeedback(`“${template.title}” copiada.`)
  }

  return (
    <div className="stack-lg deskcomm-page">
      <PageIntro
        title="Responda rápido sem soar automático."
        description="Scripts pessoais e compartilhados para a equipe usar no Inbox, com atalhos fáceis de lembrar."
        actions={
          data?.permissions.canCreate ? (
            <button
              className="button button-dark"
              onClick={() => setEditing('new')}
            >
              <Plus size={16} /> Nova resposta
            </button>
          ) : undefined
        }
      />
      {(feedback || error) && (
        <div className={error ? 'form-error' : 'form-success'} role="status">
          {error ?? feedback}
          <button
            className="icon-button compact"
            aria-label="Fechar aviso"
            onClick={() => {
              setError(null)
              setFeedback(null)
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <section className="card deskcomm-toolbar">
        <label className="search-field deskcomm-search">
          <span className="sr-only">Buscar respostas</span>
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome, texto, atalho ou categoria…"
          />
        </label>
        <StatusDot tone="blue">{templates.length} resposta(s)</StatusDot>
      </section>
      {loading && !data ? (
        <div className="card deskcomm-loading">
          <LoaderCircle className="spin" /> Carregando respostas…
        </div>
      ) : templates.length ? (
        <div className="template-grid">
          {templates.map((template) => (
            <article className="card template-card" key={template.id}>
              <header>
                <div>
                  <strong>{template.title}</strong>
                  <span>{template.category}</span>
                </div>
                <StatusDot tone={template.shared ? 'green' : 'gray'}>
                  {template.shared ? 'Equipe' : 'Pessoal'}
                </StatusDot>
              </header>
              <p>{template.body}</p>
              <footer>
                <code>{template.shortcut ?? 'sem atalho'}</code>
                <span>{template.use_count} uso(s)</span>
                <button
                  className="icon-button"
                  aria-label={`Copiar ${template.title}`}
                  onClick={() => void copy(template)}
                >
                  <Copy size={16} />
                </button>
                {template.canEdit && (
                  <button
                    className="icon-button"
                    aria-label={`Editar ${template.title}`}
                    onClick={() => setEditing(template)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {template.canEdit && (
                  <button
                    className="icon-button danger"
                    aria-label={`Remover ${template.title}`}
                    onClick={() => void remove(template)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="card deskcomm-empty">
          <strong>Nenhuma resposta encontrada.</strong>
          <p>Crie scripts reutilizáveis para dúvidas e objeções recorrentes.</p>
        </div>
      )}
      {editing && data && (
        <TemplateDialog
          template={editing === 'new' ? null : editing}
          canShare={data.permissions.canShare}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            setFeedback('Resposta rápida salva.')
            await load()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

function TemplateDialog({
  template,
  canShare,
  onClose,
  onSaved,
  onError,
}: {
  template: Template | null
  canShare: boolean
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const [title, setTitle] = useState(template?.title ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  const [shortcut, setShortcut] = useState(template?.shortcut ?? '')
  const [category, setCategory] = useState(template?.category ?? 'geral')
  const [shared, setShared] = useState(template?.shared ?? false)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await apiFetch(
        template ? `/api/templates/${template.id}` : '/api/templates',
        {
          method: template ? 'PATCH' : 'POST',
          body: JSON.stringify({
            title,
            body,
            shortcut: shortcut || null,
            category,
            shared,
          }),
        },
      )
      await onSaved()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Falha ao salvar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="deskcomm-modal-backdrop" role="presentation">
      <section
        className="deskcomm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-dialog-title"
      >
        <header>
          <h3 id="template-dialog-title">
            {template ? 'Editar resposta' : 'Nova resposta'}
          </h3>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <form className="deskcomm-form" onSubmit={submit}>
          <label>
            Título
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={100}
              required
              autoFocus
            />
          </label>
          <div className="deskcomm-form-grid">
            <label>
              Atalho
              <input
                value={shortcut}
                onChange={(event) =>
                  setShortcut(event.target.value.toLowerCase())
                }
                placeholder="/preco"
                pattern="/[a-z0-9_-]{1,30}"
              />
            </label>
            <label>
              Categoria
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={40}
                required
              />
            </label>
          </div>
          <label>
            Texto
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={4000}
              rows={8}
              required
            />
          </label>
          {canShare && (
            <div className="deskcomm-switch-row">
              <div>
                <strong>Compartilhar com a equipe</strong>
                <span>Todos os membros poderão usar esta resposta.</span>
              </div>
              <Switch
                checked={shared}
                onChange={() => setShared((value) => !value)}
                label="Compartilhar resposta"
              />
            </div>
          )}
          <div className="deskcomm-dialog-actions">
            <button
              type="button"
              className="button button-outline"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              className="button button-dark"
              disabled={busy || !title.trim() || !body.trim()}
            >
              {busy && <LoaderCircle className="spin" size={16} />} Salvar
              resposta
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
