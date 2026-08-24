/** Editor persistente das sequências executadas pelo scheduler. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Image,
  LoaderCircle,
  MessageSquareText,
  MousePointer2,
  Plus,
  Save,
  Timer,
  Trash2,
  Type,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageIntro, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/sequencias')({
  component: SequencesPage,
})

type StepKind = 'text' | 'media' | 'typing' | 'delay'
type SequenceStep = {
  id?: string
  kind: StepKind
  content: string | null
  mediaUrl: string | null
  delaySeconds: number
}
type Sequence = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  contacts: number
  activeContacts: number
  activeTriggers: number
  steps: SequenceStep[]
}
type SequencePayload = {
  sequences: Sequence[]
  permissions: { canManage: boolean }
}

function blankStep(kind: StepKind): SequenceStep {
  if (kind === 'typing')
    return { kind, content: null, mediaUrl: null, delaySeconds: 2 }
  if (kind === 'delay')
    return { kind, content: null, mediaUrl: null, delaySeconds: 3_600 }
  if (kind === 'media')
    return { kind, content: '', mediaUrl: '', delaySeconds: 0 }
  return { kind, content: '', mediaUrl: null, delaySeconds: 0 }
}

function formatDelay(seconds: number) {
  if (seconds >= 86_400 && seconds % 86_400 === 0)
    return `${seconds / 86_400} dia(s)`
  if (seconds >= 3_600 && seconds % 3_600 === 0)
    return `${seconds / 3_600} hora(s)`
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} minuto(s)`
  return `${seconds} segundo(s)`
}

function SequencesPage() {
  const [data, setData] = useState<SequencePayload | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Sequence | null>(null)
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)

  const load = useCallback(
    async (preferredId?: string) => {
      setBusy('load')
      try {
        const result = await apiFetch<SequencePayload>('/api/sequences')
        setData(result)
        const id =
          preferredId ??
          selectedId ??
          (result.sequences.length > 0 ? result.sequences[0].id : null)
        setSelectedId(id)
        setDraft(result.sequences.find((item) => item.id === id) ?? null)
        setFeedback(null)
      } catch (error) {
        setFeedback({
          tone: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'Falha ao carregar sequências.',
        })
      } finally {
        setBusy(null)
      }
    },
    [selectedId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const hasChanges = useMemo(() => {
    if (!draft || !data) return false
    const original = data.sequences.find((item) => item.id === draft.id)
    return JSON.stringify(original) !== JSON.stringify(draft)
  }, [data, draft])

  function selectSequence(sequence: Sequence) {
    if (hasChanges && !window.confirm('Descartar alterações não salvas?'))
      return
    setSelectedId(sequence.id)
    setDraft(structuredClone(sequence))
    setFeedback(null)
  }

  async function createSequence() {
    const name = window.prompt('Nome da nova sequência:', 'Nova sequência')
    if (!name?.trim()) return
    setBusy('create')
    try {
      const result = await apiFetch<{ id: string }>('/api/sequences', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: '',
          isActive: false,
          steps: [blankStep('text')],
        }),
      })
      await load(result.id)
      setFeedback({ tone: 'success', text: 'Sequência criada e persistida.' })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao criar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function saveSequence(nextDraft = draft) {
    if (!nextDraft) return
    setBusy('save')
    try {
      await apiFetch('/api/sequences', {
        method: 'PATCH',
        body: JSON.stringify({
          id: nextDraft.id,
          name: nextDraft.name,
          description: nextDraft.description,
          isActive: nextDraft.isActive,
          steps: nextDraft.steps.map(
            ({ kind, content, mediaUrl, delaySeconds }) => ({
              kind,
              content,
              mediaUrl,
              delaySeconds,
            }),
          ),
        }),
      })
      await load(nextDraft.id)
      setFeedback({ tone: 'success', text: 'Sequência salva com segurança.' })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function validateSequence() {
    if (!draft) return
    if (hasChanges) await saveSequence()
    setBusy('validate')
    try {
      const result = await apiFetch<{
        validation: {
          steps: number
          sendingSteps: number
          durationSeconds: number
        }
      }>('/api/sequences', {
        method: 'PUT',
        body: JSON.stringify({ id: draft.id }),
      })
      setFeedback({
        tone: 'success',
        text: `Fluxo válido: ${result.validation.steps} blocos, ${result.validation.sendingSteps} envios e duração mínima de ${formatDelay(result.validation.durationSeconds)}. O compliance será rechecado em cada mensagem.`,
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Fluxo inválido.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function deleteSequence() {
    if (!draft || !window.confirm(`Excluir “${draft.name}”?`)) return
    setBusy('delete')
    try {
      await apiFetch('/api/sequences', {
        method: 'DELETE',
        body: JSON.stringify({ id: draft.id }),
      })
      setSelectedId(null)
      await load()
      setFeedback({ tone: 'success', text: 'Sequência excluída.' })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao excluir.',
      })
    } finally {
      setBusy(null)
    }
  }

  function updateStep(index: number, changes: Partial<SequenceStep>) {
    if (!draft) return
    const steps = draft.steps.map((step, current) =>
      current === index ? { ...step, ...changes } : step,
    )
    setDraft({ ...draft, steps })
  }

  function moveStep(index: number, direction: -1 | 1) {
    if (!draft) return
    const next = index + direction
    if (next < 0 || next >= draft.steps.length) return
    const steps = [...draft.steps]
    ;[steps[index], steps[next]] = [steps[next], steps[index]]
    setDraft({ ...draft, steps })
  }

  function removeStep(index: number) {
    if (!draft || draft.steps.length === 1) return
    setDraft({
      ...draft,
      steps: draft.steps.filter((_, item) => item !== index),
    })
  }

  const canManage = data?.permissions.canManage ?? false
  return (
    <div className="stack-lg">
      <PageIntro
        title="Conversa que continua."
        description="Monte jornadas reais de DM; o scheduler respeita janela, opt-out, cooldown e idempotência em cada passo."
        actions={
          <button
            className="button button-dark"
            onClick={() => void createSequence()}
            disabled={!canManage || Boolean(busy)}
          >
            {busy === 'create' ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}
            Nova sequência
          </button>
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
      <div className="sequence-layout">
        <aside className="card sequence-sidebar">
          <div className="section-title">
            <span>SUAS SEQUÊNCIAS</span>
            <button
              className="icon-button"
              onClick={() => void createSequence()}
              disabled={!canManage || Boolean(busy)}
              aria-label="Nova sequência"
            >
              <Plus size={16} />
            </button>
          </div>
          {busy === 'load' && !data && (
            <div className="inbox-empty">
              <LoaderCircle className="spin" size={18} /> Carregando…
            </div>
          )}
          {data?.sequences.map((sequence) => (
            <div
              className={`sequence-list-item ${selectedId === sequence.id ? 'active' : ''}`}
              key={sequence.id}
            >
              <button type="button" onClick={() => selectSequence(sequence)}>
                <strong>{sequence.name}</strong>
                <small>
                  {sequence.steps.length} passos · {sequence.contacts} contatos
                </small>
              </button>
              <Switch
                checked={sequence.isActive}
                label={`Ativar ${sequence.name}`}
                disabled={!canManage || Boolean(busy)}
                onChange={() =>
                  void saveSequence({
                    ...sequence,
                    isActive: !sequence.isActive,
                  })
                }
              />
            </div>
          ))}
          {data && data.sequences.length === 0 && (
            <div className="inbox-empty">Crie sua primeira sequência.</div>
          )}
        </aside>

        <section className="card sequence-editor">
          {!draft ? (
            <div className="inbox-empty">
              Selecione ou crie uma sequência para editar.
            </div>
          ) : (
            <>
              <header>
                <div className="sequence-title-fields">
                  <span className="eyebrow">EDITOR VISUAL PERSISTENTE</span>
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    disabled={!canManage}
                    aria-label="Nome da sequência"
                  />
                  <input
                    value={draft.description ?? ''}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                    disabled={!canManage}
                    placeholder="Descrição opcional"
                    aria-label="Descrição da sequência"
                  />
                </div>
                <div>
                  <span className="saved-state">
                    {hasChanges ? 'Alterações não salvas' : 'Salvo no backend'}
                  </span>
                  <button
                    className="button button-outline"
                    onClick={() => void validateSequence()}
                    disabled={Boolean(busy)}
                  >
                    {busy === 'validate' ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <MousePointer2 size={15} />
                    )}{' '}
                    Validar fluxo
                  </button>
                  <button
                    className="button button-dark"
                    onClick={() => void saveSequence()}
                    disabled={!canManage || !hasChanges || Boolean(busy)}
                  >
                    {busy === 'save' ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Save size={15} />
                    )}{' '}
                    Salvar
                  </button>
                </div>
              </header>
              <div className="canvas">
                <div className="start-node">
                  <MousePointer2 size={18} />
                  <span>
                    <strong>ENTRADA</strong>
                    <small>Gatilho ou automação vinculada</small>
                  </span>
                </div>
                {draft.steps.map((step, index) => {
                  const Icon =
                    step.kind === 'text'
                      ? Type
                      : step.kind === 'media'
                        ? Image
                        : step.kind === 'typing'
                          ? Timer
                          : Clock3
                  return (
                    <div
                      key={`${step.id ?? 'new'}-${index}`}
                      className="step-wrap"
                    >
                      <span className="connector" />
                      <article className={`flow-node kind-${step.kind}`}>
                        <span className="node-icon">
                          <Icon size={18} />
                        </span>
                        <div className="sequence-step-fields">
                          <strong>
                            {step.kind === 'text'
                              ? 'Mensagem de texto'
                              : step.kind === 'media'
                                ? 'Mídia pública'
                                : step.kind === 'typing'
                                  ? 'Digitando…'
                                  : 'Esperar'}
                          </strong>
                          {(step.kind === 'text' || step.kind === 'media') && (
                            <textarea
                              value={step.content ?? ''}
                              onChange={(event) =>
                                updateStep(index, {
                                  content: event.target.value,
                                })
                              }
                              disabled={!canManage}
                              placeholder={
                                step.kind === 'text'
                                  ? 'Escreva a mensagem'
                                  : 'Legenda opcional'
                              }
                            />
                          )}
                          {step.kind === 'media' && (
                            <input
                              type="url"
                              value={step.mediaUrl ?? ''}
                              onChange={(event) =>
                                updateStep(index, {
                                  mediaUrl: event.target.value,
                                })
                              }
                              disabled={!canManage}
                              placeholder="https://.../arquivo.jpg"
                            />
                          )}
                          <label>
                            {step.kind === 'typing'
                              ? 'Duração (segundos)'
                              : step.kind === 'delay'
                                ? 'Espera (segundos)'
                                : 'Aguardar antes de enviar (segundos)'}
                            <input
                              type="number"
                              min={step.kind === 'delay' ? 60 : 0}
                              max={604800}
                              value={step.delaySeconds}
                              onChange={(event) =>
                                updateStep(index, {
                                  delaySeconds: Number(event.target.value),
                                })
                              }
                              disabled={!canManage}
                            />
                          </label>
                        </div>
                        <div className="sequence-step-actions">
                          <button
                            className="icon-button"
                            onClick={() => moveStep(index, -1)}
                            disabled={!canManage || index === 0}
                            aria-label="Mover bloco para cima"
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            className="icon-button"
                            onClick={() => moveStep(index, 1)}
                            disabled={
                              !canManage || index === draft.steps.length - 1
                            }
                            aria-label="Mover bloco para baixo"
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            className="icon-button"
                            onClick={() => removeStep(index)}
                            disabled={!canManage || draft.steps.length === 1}
                            aria-label="Remover bloco"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </article>
                    </div>
                  )
                })}
                <span className="connector" />
                <div className="block-options">
                  <button
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [...draft.steps, blankStep('text')],
                      })
                    }
                    disabled={!canManage}
                  >
                    <Type size={15} /> Texto
                  </button>
                  <button
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [...draft.steps, blankStep('media')],
                      })
                    }
                    disabled={!canManage}
                  >
                    <Image size={15} /> Mídia
                  </button>
                  <button
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [...draft.steps, blankStep('typing')],
                      })
                    }
                    disabled={!canManage}
                  >
                    <Timer size={15} /> Typing
                  </button>
                  <button
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [...draft.steps, blankStep('delay')],
                      })
                    }
                    disabled={!canManage}
                  >
                    <Clock3 size={15} /> Delay
                  </button>
                </div>
              </div>
              <footer className="sequence-editor-footer">
                <span>
                  <MessageSquareText size={15} /> {draft.activeTriggers}{' '}
                  gatilhos ativos · {draft.activeContacts} execuções em curso
                </span>
                <button
                  className="button button-outline danger"
                  onClick={() => void deleteSequence()}
                  disabled={!canManage || Boolean(busy)}
                >
                  <Trash2 size={15} /> Excluir sequência
                </button>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
