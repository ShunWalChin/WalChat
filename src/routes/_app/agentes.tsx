/** CRUD de agentes, base de conhecimento e playground autenticado. */
import { createFileRoute } from '@tanstack/react-router'
import {
  BookOpen,
  Bot,
  BrainCircuit,
  ExternalLink,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PageIntro, StatusDot, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

type Agent = {
  id: string
  name: string
  persona: string
  mode: 'copilot' | 'autonomous'
  tone: string
  isActive: boolean
  providerOverride: 'openai' | 'google' | null
  modelOverride: string | null
  maxReplyChars: number
  fallbackToCopilot: boolean
  knowledgeCount: number
}

type KnowledgeDocument = {
  id: string
  ai_agent_id: string | null
  title: string
  content: string
  source_type: 'text' | 'url' | 'file'
  source_url: string | null
  status: 'ready' | 'processing' | 'failed'
  last_used_at: string | null
  updated_at: string
}

const emptyAgent: Omit<Agent, 'id' | 'knowledgeCount'> = {
  name: 'Novo agente',
  persona:
    'Atenda creators com proximidade, clareza e foco em resolver a dúvida antes de vender.',
  mode: 'copilot',
  tone: 'Próximo e direto',
  isActive: true,
  providerOverride: null,
  modelOverride: null,
  maxReplyChars: 500,
  fallbackToCopilot: true,
}

export const Route = createFileRoute('/_app/agentes')({ component: AgentsPage })

function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Agent | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [documentTitle, setDocumentTitle] = useState('')
  const [documentContent, setDocumentContent] = useState('')
  const [documentSourceUrl, setDocumentSourceUrl] = useState('')
  const [prompt, setPrompt] = useState(
    'Oi, vi seu conteúdo e queria entender como funciona a mentoria.',
  )
  const [answer, setAnswer] = useState('')
  const [modelUsed, setModelUsed] = useState('')
  const [answerSources, setAnswerSources] = useState<
    Array<{ id: string; title: string; sourceUrl: string | null }>
  >([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadAgents = useCallback(
    async (preferId?: string) => {
      try {
        const result = await apiFetch<{ agents: Agent[] }>('/api/ai/agents')
        setAgents(result.agents)
        const nextId =
          preferId ??
          (result.agents.some((item) => item.id === selectedId)
            ? selectedId
            : result.agents[0]?.id)
        setSelectedId(nextId ?? null)
        setForm(result.agents.find((item) => item.id === nextId) ?? null)
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Falha ao carregar.',
        )
      }
    },
    [selectedId],
  )

  const loadDocuments = useCallback(async (agentId: string) => {
    try {
      const result = await apiFetch<{ documents: KnowledgeDocument[] }>(
        `/api/ai/knowledge?agentId=${encodeURIComponent(agentId)}`,
      )
      setDocuments(result.documents)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha na base.')
    }
  }, [])

  useEffect(() => {
    void loadAgents()
  }, []) // A seleção subsequente é controlada pelas ações da própria tela.

  useEffect(() => {
    if (selectedId) void loadDocuments(selectedId)
    else setDocuments([])
  }, [loadDocuments, selectedId])

  function selectAgent(agent: Agent) {
    setSelectedId(agent.id)
    setForm(agent)
    setAnswer('')
    setAnswerSources([])
    setError('')
  }

  async function createAgent() {
    setBusy('create')
    setError('')
    try {
      const result = await apiFetch<{ id: string }>('/api/ai/agents', {
        method: 'POST',
        body: JSON.stringify(emptyAgent),
      })
      await loadAgents(result.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao criar.')
    } finally {
      setBusy(null)
    }
  }

  async function saveAgent() {
    if (!form) return
    setBusy('save')
    setError('')
    try {
      await apiFetch('/api/ai/agents', {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      await loadAgents(form.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar.')
    } finally {
      setBusy(null)
    }
  }

  async function toggleAgent(agent: Agent) {
    try {
      await apiFetch('/api/ai/agents', {
        method: 'PATCH',
        body: JSON.stringify({ id: agent.id, isActive: !agent.isActive }),
      })
      await loadAgents(agent.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao alterar.')
    }
  }

  async function addDocument() {
    if (!selectedId || !documentTitle.trim() || !documentContent.trim()) return
    setBusy('knowledge')
    try {
      await apiFetch('/api/ai/knowledge', {
        method: 'POST',
        body: JSON.stringify({
          agentId: selectedId,
          title: documentTitle,
          content: documentContent,
          sourceType: documentSourceUrl.trim() ? 'url' : 'text',
          sourceUrl: documentSourceUrl.trim() || null,
        }),
      })
      setDocumentTitle('')
      setDocumentContent('')
      setDocumentSourceUrl('')
      await Promise.all([loadDocuments(selectedId), loadAgents(selectedId)])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao adicionar.')
    } finally {
      setBusy(null)
    }
  }

  async function deleteDocument(id: string) {
    if (!selectedId || !window.confirm('Excluir este documento da base?'))
      return
    try {
      await apiFetch('/api/ai/knowledge', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      })
      await Promise.all([loadDocuments(selectedId), loadAgents(selectedId)])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao excluir.')
    }
  }

  async function runPlayground() {
    if (!selectedId || !prompt.trim()) return
    setBusy('playground')
    setAnswer('')
    setAnswerSources([])
    setError('')
    try {
      const result = await apiFetch<{
        suggestion: string
        provider: string
        model: string
        sources: Array<{ id: string; title: string; sourceUrl: string | null }>
      }>('/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({
          agentId: selectedId,
          history: [{ role: 'user', content: prompt }],
        }),
      })
      setAnswer(result.suggestion)
      setModelUsed(`${result.provider} · ${result.model}`)
      setAnswerSources(result.sources)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha no playground.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="IA com o seu jeito."
        description="Personas persistidas, conhecimento por agente e execução via API no playground."
        actions={
          <button
            className="button button-orange"
            onClick={() => void createAgent()}
            disabled={Boolean(busy)}
          >
            {busy === 'create' ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}
            Novo agente
          </button>
        }
      />
      {error && <div className="form-error">{error}</div>}
      {agents.length === 0 && !error ? (
        <div className="card empty-integration">
          <Bot size={28} />
          <h3>Nenhum agente configurado</h3>
          <p>Crie o primeiro agente para liberar o copiloto e o playground.</p>
        </div>
      ) : (
        <div className="agents-grid">
          {agents.map((agent) => (
            <article
              className={`card agent-card ${selectedId === agent.id ? 'selected' : ''}`}
              key={agent.id}
              onClick={() => selectAgent(agent)}
            >
              <span className="agent-avatar">
                <Bot size={22} />
              </span>
              <div className="agent-title">
                <h3>{agent.name}</h3>
                <Switch
                  checked={agent.isActive}
                  label={agent.name}
                  onChange={() => void toggleAgent(agent)}
                />
              </div>
              <span
                className={`mode-chip ${agent.mode === 'autonomous' ? 'autonomous' : ''}`}
              >
                {agent.mode === 'autonomous' ? 'Autônomo' : 'Co-piloto'}
              </span>
              <p>{agent.persona}</p>
              <footer>
                <BookOpen size={14} /> {agent.knowledgeCount} fontes de
                conhecimento
              </footer>
            </article>
          ))}
        </div>
      )}

      {form && (
        <div className="playground-grid">
          <section className="card agent-config">
            <div className="card-head">
              <div>
                <span className="eyebrow">PERSONA SELECIONADA</span>
                <h3>{form.name}</h3>
              </div>
              <BrainCircuit size={20} />
            </div>
            <label>
              Nome
              <input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
            <label>
              Instruções da persona
              <textarea
                value={form.persona}
                onChange={(event) =>
                  setForm({ ...form, persona: event.target.value })
                }
              />
            </label>
            <div className="two-fields">
              <label>
                Modo
                <select
                  value={form.mode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      mode: event.target.value as 'copilot' | 'autonomous',
                    })
                  }
                >
                  <option value="copilot">Co-piloto</option>
                  <option value="autonomous">Autônomo</option>
                </select>
              </label>
              <label>
                Tom
                <input
                  value={form.tone}
                  onChange={(event) =>
                    setForm({ ...form, tone: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="two-fields">
              <label>
                Provedor
                <select
                  value={form.providerOverride ?? ''}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      providerOverride:
                        event.target.value === ''
                          ? null
                          : (event.target.value as 'openai' | 'google'),
                    })
                  }
                >
                  <option value="">Padrão do workspace</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google</option>
                </select>
              </label>
              <label>
                Limite da resposta
                <input
                  type="number"
                  min={100}
                  max={1000}
                  value={form.maxReplyChars}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      maxReplyChars: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <button
              className="button button-dark"
              onClick={() => void saveAgent()}
              disabled={Boolean(busy)}
            >
              <Save size={15} /> Salvar agente
            </button>
          </section>

          <section className="card playground">
            <div className="card-head">
              <div>
                <span className="eyebrow">PLAYGROUND</span>
                <h3>Teste antes de liberar</h3>
              </div>
              <StatusDot tone={answer ? 'green' : 'gray'}>
                {modelUsed || 'Aguardando teste'}
              </StatusDot>
            </div>
            <div className="playground-chat">
              <div className="test-message user">
                <MessageSquareText size={15} />
                <p>{prompt}</p>
              </div>
              {answer && (
                <div className="test-message ai">
                  <Sparkles size={15} />
                  <div>
                    <p>{answer}</p>
                    {answerSources.length > 0 && (
                      <footer className="playground-sources">
                        <BookOpen size={12} />
                        {answerSources.map((source) =>
                          source.sourceUrl ? (
                            <a
                              href={source.sourceUrl}
                              key={source.id}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.title}
                            </a>
                          ) : (
                            <span key={source.id}>{source.title}</span>
                          ),
                        )}
                      </footer>
                    )}
                  </div>
                </div>
              )}
              {busy === 'playground' && (
                <div className="thinking">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </div>
            <div className="prompt-box">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <button
                className="send-button"
                onClick={() => void runPlayground()}
                disabled={busy === 'playground'}
              >
                <Send size={16} />
              </button>
            </div>
            <small>O teste gera via API, mas nunca envia ao Instagram.</small>
          </section>
        </div>
      )}

      {form && (
        <section className="card knowledge-manager">
          <div className="card-head">
            <div>
              <span className="eyebrow">BASE DE CONHECIMENTO</span>
              <h3>Fontes do agente</h3>
            </div>
            <BookOpen size={20} />
          </div>
          <div className="knowledge-editor">
            <label>
              Título
              <input
                value={documentTitle}
                onChange={(event) => setDocumentTitle(event.target.value)}
                placeholder="Ex.: Valores e condições da mentoria"
              />
            </label>
            <label>
              URL de origem (opcional)
              <input
                type="url"
                value={documentSourceUrl}
                onChange={(event) => setDocumentSourceUrl(event.target.value)}
                placeholder="https://seusite.com/politica-comercial"
              />
            </label>
            <label>
              Conteúdo
              <textarea
                value={documentContent}
                onChange={(event) => setDocumentContent(event.target.value)}
                placeholder="Cole aqui somente informações aprovadas para o agente usar."
              />
            </label>
            <button
              className="button button-outline"
              onClick={() => void addDocument()}
              disabled={busy === 'knowledge'}
            >
              <Plus size={15} /> Adicionar fonte
            </button>
          </div>
          <div className="knowledge-list">
            {documents.map((document) => (
              <article key={document.id}>
                <div>
                  <strong>{document.title}</strong>
                  <p>{document.content}</p>
                  <small>
                    {document.source_url ? (
                      <a
                        href={document.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={12} /> Abrir fonte
                      </a>
                    ) : (
                      'Texto interno'
                    )}
                    {document.last_used_at
                      ? ` · usada em ${new Date(document.last_used_at).toLocaleDateString('pt-BR')}`
                      : ' · ainda não consultada'}
                  </small>
                </div>
                <button
                  className="icon-button"
                  onClick={() => void deleteDocument(document.id)}
                  aria-label={`Excluir ${document.title}`}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
