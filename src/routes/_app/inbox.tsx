/** Inbox unificada ligada ao Postgres, ao copiloto de IA e ao sender Meta. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Bot,
  BookOpen,
  CheckCircle2,
  Clock3,
  Flag,
  Info,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  StickyNote,
  Tag,
  Trash2,
  UserCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StatusDot, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/inbox')({ component: InboxPage })

type InboxCategory = 'principal' | 'geral' | 'pedidos' | 'ia_off'
type Conversation = {
  id: string
  contactId: string
  platform: 'instagram' | 'whatsapp'
  instagramAccountId: string | null
  whatsappAccountId: string | null
  category: InboxCategory
  status: 'open' | 'pending' | 'resolved'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  assignedTo: string | null
  unread: number
  preview: string
  lastMessageAt: string | null
  name: string
  username: string
  avatarUrl: string | null
  aiEnabled: boolean
  optedOut: boolean
  firstSeenAt: string | null
  open24h: boolean
  humanAgentEligible: boolean
  secondsLeft24h: number
}
type ChatMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  media_url: string | null
  message_type: string
  status: string
  is_ai_generated: boolean
  is_automated: boolean
  created_at: string
}
type Agent = { id: string; name: string; mode: 'copilot' | 'autonomous' }
type AiSource = {
  id: string
  title: string
  sourceType: 'text' | 'url' | 'file'
  sourceUrl: string | null
  rank: number | null
}
type ConversationNote = {
  id: string
  author_user_id: string | null
  body: string
  created_at: string
  updated_at: string
}
type WhatsAppTemplate = {
  id: string
  name: string
  language: string
  category: string | null
  status: string
  components: unknown[]
}
type ContactTag = { id: string; name: string; color: string }
type InboxResponse = {
  conversations: Conversation[]
  selectedId: string | null
  messages: ChatMessage[]
  agents: Agent[]
  notes: ConversationNote[]
  whatsappTemplates: WhatsAppTemplate[]
  currentUser: { id: string; email: string | null }
}

const palette = ['#F8C8AE', '#BFE3D0', '#C9D8F2', '#F6D987', '#DCC7EE']

function initials(name: string) {
  return name
    .replace('@', '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function timeLabel(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function countdown(seconds: number) {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  return `${hours}h ${String(minutes).padStart(2, '0')}min restantes`
}

function InboxPage() {
  const [tab, setTab] = useState<InboxCategory>('principal')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [notes, setNotes] = useState<ConversationNote[]>([])
  const [whatsappTemplates, setWhatsAppTemplates] = useState<
    WhatsAppTemplate[]
  >([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [agentId, setAgentId] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [draftFromAi, setDraftFromAi] = useState(false)
  const [aiSources, setAiSources] = useState<AiSource[]>([])
  const [humanAgent, setHumanAgent] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [templateComponents, setTemplateComponents] = useState('[]')
  const [mediaOpen, setMediaOpen] = useState(false)
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image')
  const [tagOpen, setTagOpen] = useState(false)
  const [catalogTags, setCatalogTags] = useState<ContactTag[]>([])
  const [contactTagIds, setContactTagIds] = useState<string[]>([])
  const [tagsBusy, setTagsBusy] = useState(false)
  const [busy, setBusy] = useState<string | null>('load')
  const [error, setError] = useState('')
  const pendingSendKey = useRef<string | null>(null)

  const loadInbox = useCallback(
    async (
      category: InboxCategory,
      conversationId?: string,
      silent = false,
    ) => {
      if (!silent) setBusy('load')
      try {
        const params = new URLSearchParams({ category })
        if (conversationId) params.set('conversationId', conversationId)
        const result = await apiFetch<InboxResponse>(
          `/api/inbox?${params.toString()}`,
        )
        setConversations(result.conversations)
        setSelectedId(result.selectedId)
        setMessages(result.messages)
        setAgents(result.agents)
        setNotes(result.notes)
        setWhatsAppTemplates(result.whatsappTemplates)
        setTemplateId((current) =>
          result.whatsappTemplates.some((template) => template.id === current)
            ? current
            : (result.whatsappTemplates[0]?.id ?? ''),
        )
        setCurrentUserId(result.currentUser.id)
        setAgentId((current) =>
          result.agents.some((agent) => agent.id === current)
            ? current
            : (result.agents[0]?.id ?? ''),
        )
        if (!silent) setError('')
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Falha ao abrir a Inbox.',
        )
      } finally {
        if (!silent) setBusy(null)
      }
    },
    [],
  )

  useEffect(() => {
    setHumanAgent(false)
    setDraft('')
    setDraftFromAi(false)
    setAiSources([])
    setTemplateId('')
    setTemplateComponents('[]')
    setMediaOpen(false)
    setMediaUrl('')
    setTagOpen(false)
    setContactTagIds([])
    pendingSendKey.current = null
    void loadInbox(tab)
  }, [loadInbox, tab])

  useEffect(() => {
    const interval = window.setInterval(
      () => void loadInbox(tab, selectedId ?? undefined, true),
      10_000,
    )
    return () => window.clearInterval(interval)
  }, [loadInbox, selectedId, tab])

  const selected = conversations.find((item) => item.id === selectedId) ?? null
  const selectedTemplate =
    whatsappTemplates.find((template) => template.id === templateId) ?? null
  const requiresWhatsAppTemplate = Boolean(
    selected?.platform === 'whatsapp' && !selected.open24h,
  )
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalized) return conversations
    return conversations.filter(
      (conversation) =>
        conversation.name.toLocaleLowerCase('pt-BR').includes(normalized) ||
        conversation.username.toLocaleLowerCase('pt-BR').includes(normalized) ||
        conversation.preview.toLocaleLowerCase('pt-BR').includes(normalized),
    )
  }, [conversations, query])
  const canCompose = Boolean(
    selected &&
    selected.status !== 'resolved' &&
    !selected.optedOut &&
    (selected.platform === 'whatsapp'
      ? selected.open24h || Boolean(selectedTemplate)
      : selected.open24h || (selected.humanAgentEligible && humanAgent)),
  )

  async function selectConversation(conversationId: string) {
    setHumanAgent(false)
    setDraft('')
    setDraftFromAi(false)
    setAiSources([])
    setTemplateId('')
    setTemplateComponents('[]')
    setMediaOpen(false)
    setMediaUrl('')
    setTagOpen(false)
    setContactTagIds([])
    pendingSendKey.current = null
    try {
      await apiFetch('/api/inbox', {
        method: 'PATCH',
        body: JSON.stringify({ conversationId, markRead: true }),
      })
      await loadInbox(tab, conversationId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao abrir.')
    }
  }

  /** Gera texto no composer; nunca envia automaticamente. */
  async function suggest() {
    if (!selected || !agentId || !selected.open24h) return
    setBusy('suggest')
    try {
      if (!messages.some((message) => message.body?.trim()))
        throw new Error('A conversa ainda não tem texto.')
      const result = await apiFetch<{
        suggestion: string
        sources: AiSource[]
      }>('/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({ agentId, conversationId: selected.id }),
      })
      setDraft(result.suggestion)
      setDraftFromAi(true)
      setAiSources(result.sources)
      pendingSendKey.current = null
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha na sugestão.')
    } finally {
      setBusy(null)
    }
  }

  /** Envia pela API autenticada; o backend decide novamente se a janela permite. */
  async function sendMessage() {
    if (
      !selected ||
      !canCompose ||
      (!draft.trim() && !mediaUrl.trim() && !requiresWhatsAppTemplate)
    )
      return
    if (humanAgent && draftFromAi) {
      setError('HUMAN_AGENT exige uma resposta escrita e revisada pelo humano.')
      return
    }
    setBusy('send')
    const idempotencyKey =
      pendingSendKey.current ?? `manual:${crypto.randomUUID()}`
    pendingSendKey.current = idempotencyKey
    try {
      let components: Array<Record<string, unknown>> | undefined
      if (requiresWhatsAppTemplate) {
        const parsed = JSON.parse(templateComponents) as unknown
        if (!Array.isArray(parsed))
          throw new Error('Os componentes do template devem ser um array JSON.')
        components = parsed as Array<Record<string, unknown>>
      }
      await apiFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          contactId: selected.contactId,
          message: requiresWhatsAppTemplate ? undefined : draft,
          mediaUrl:
            !requiresWhatsAppTemplate && mediaUrl.trim()
              ? mediaUrl.trim()
              : undefined,
          mediaType:
            !requiresWhatsAppTemplate && mediaUrl.trim()
              ? mediaType
              : undefined,
          humanAgent,
          aiGenerated: draftFromAi,
          template:
            requiresWhatsAppTemplate && selectedTemplate
              ? {
                  name: selectedTemplate.name,
                  language: selectedTemplate.language,
                  ...(components?.length ? { components } : {}),
                }
              : undefined,
        }),
      })
      setDraft('')
      setDraftFromAi(false)
      setAiSources([])
      setMediaOpen(false)
      setMediaUrl('')
      pendingSendKey.current = null
      await loadInbox(tab, selected.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao enviar.')
    } finally {
      setBusy(null)
    }
  }

  async function toggleAi() {
    if (!selected) return
    try {
      await apiFetch('/api/inbox', {
        method: 'PATCH',
        body: JSON.stringify({
          conversationId: selected.id,
          aiEnabled: !selected.aiEnabled,
        }),
      })
      await loadInbox(tab, selected.id)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao alterar IA.',
      )
    }
  }

  async function updateConversation(
    changes: Partial<Pick<Conversation, 'status' | 'priority' | 'assignedTo'>>,
  ) {
    if (!selected) return
    setBusy('conversation-update')
    try {
      await apiFetch('/api/inbox', {
        method: 'PATCH',
        body: JSON.stringify({ conversationId: selected.id, ...changes }),
      })
      await loadInbox(tab, selected.id, true)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao atualizar.')
    } finally {
      setBusy(null)
    }
  }

  async function addNote() {
    if (!selected || !noteDraft.trim()) return
    setBusy('note')
    try {
      await apiFetch('/api/inbox', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: selected.id,
          body: noteDraft,
        }),
      })
      setNoteDraft('')
      await loadInbox(tab, selected.id, true)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha na nota.')
    } finally {
      setBusy(null)
    }
  }

  async function deleteNote(noteId: string) {
    if (!selected) return
    try {
      await apiFetch('/api/inbox', {
        method: 'DELETE',
        body: JSON.stringify({ noteId }),
      })
      await loadInbox(tab, selected.id, true)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao excluir nota.',
      )
    }
  }

  async function openTags() {
    if (!selected) return
    if (tagOpen) {
      setTagOpen(false)
      return
    }
    setTagsBusy(true)
    try {
      const [catalog, detail] = await Promise.all([
        apiFetch<{ tags: ContactTag[] }>('/api/contact-tags'),
        apiFetch<{ contact: { tags: ContactTag[] } }>(
          `/api/contacts/${selected.contactId}`,
        ),
      ])
      setCatalogTags(catalog.tags)
      setContactTagIds(detail.contact.tags.map((tag) => tag.id))
      setTagOpen(true)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha nas tags.')
    } finally {
      setTagsBusy(false)
    }
  }

  async function toggleContactTag(tagId: string) {
    if (!selected) return
    const hasTag = contactTagIds.includes(tagId)
    setTagsBusy(true)
    try {
      await apiFetch('/api/contacts/bulk', {
        method: 'PATCH',
        body: JSON.stringify({
          contactIds: [selected.contactId],
          action: hasTag ? 'remove_tag' : 'add_tag',
          tagId,
        }),
      })
      setContactTagIds((current) =>
        hasTag
          ? current.filter((id) => id !== tagId)
          : [...current, tagId],
      )
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha na tag.')
    } finally {
      setTagsBusy(false)
    }
  }

  return (
    <div className="inbox-shell">
      <section className="conversation-list">
        <div className="inbox-tabs">
          {(['principal', 'geral', 'pedidos', 'ia_off'] as const).map(
            (item) => (
              <button
                key={item}
                className={tab === item ? 'active' : ''}
                onClick={() => setTab(item)}
              >
                {item === 'ia_off' ? 'IA off' : item}
              </button>
            ),
          )}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            placeholder="Buscar conversa…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="conversation-scroll">
          {busy === 'load' && conversations.length === 0 && (
            <div className="inbox-empty">
              <LoaderCircle className="spin" /> Carregando…
            </div>
          )}
          {visible.map((conversation, index) => (
            <button
              key={conversation.id}
              className={`conversation-row ${selectedId === conversation.id ? 'active' : ''}`}
              onClick={() => void selectConversation(conversation.id)}
            >
              <span
                className="avatar"
                style={{ background: palette[index % palette.length] }}
              >
                {initials(conversation.name)}
              </span>
              <span className="conversation-copy">
                <strong>
                  {conversation.name}
                  <time>{timeLabel(conversation.lastMessageAt)}</time>
                </strong>
                <small>
                  {conversation.platform === 'whatsapp' ? (
                    <MessageCircle size={12} aria-label="WhatsApp" />
                  ) : (
                    '@'
                  )}
                  {conversation.username}
                </small>
                <p>{conversation.preview || 'Nova interação'}</p>
              </span>
              {conversation.unread > 0 && <em>{conversation.unread}</em>}
            </button>
          ))}
          {busy !== 'load' && visible.length === 0 && (
            <div className="inbox-empty">Nenhuma conversa nesta aba.</div>
          )}
        </div>
      </section>

      <section className="chat-panel">
        {selected ? (
          <>
            <header className="chat-header">
              <span className="avatar">{initials(selected.name)}</span>
              <div>
                <strong>{selected.name}</strong>
                <small>
                  {selected.platform === 'whatsapp'
                    ? `WhatsApp · ${selected.username}`
                    : `Instagram · @${selected.username}`}
                </small>
              </div>
              <span
                className={`window-badge ${selected.open24h ? 'open' : 'closed'}`}
              >
                <Clock3 size={14} />
                {selected.open24h
                  ? countdown(selected.secondsLeft24h)
                  : 'Janela 24h fechada'}
              </span>
              <button
                className={`assignee-button ${selected.assignedTo === currentUserId ? 'active' : ''}`}
                onClick={() =>
                  void updateConversation({
                    assignedTo:
                      selected.assignedTo === currentUserId
                        ? null
                        : currentUserId,
                  })
                }
                disabled={busy === 'conversation-update'}
              >
                <UserCheck size={15} />
                {selected.assignedTo === currentUserId
                  ? 'Com você'
                  : selected.assignedTo
                    ? 'Atribuída'
                    : 'Assumir'}
              </button>
            </header>
            {!selected.open24h && (
              <div className="window-warning">
                <ShieldAlert size={17} />
                <span>
                  {selected.optedOut
                    ? 'Contato opt-out: qualquer envio está bloqueado.'
                    : selected.platform === 'whatsapp'
                      ? 'Janela encerrada: selecione um template aprovado do WhatsApp.'
                      : selected.humanAgentEligible
                        ? 'Só atendimento humano com HUMAN_AGENT está elegível.'
                        : 'Janela encerrada: nenhuma mensagem está elegível.'}
                </span>
              </div>
            )}
            <div className="messages-scroll">
              <div className="day-separator">
                <span>CONVERSA</span>
              </div>
              {messages.map((message) => {
                const from =
                  message.direction === 'inbound'
                    ? 'them'
                    : message.is_automated
                      ? 'bot'
                      : 'me'
                return (
                  <div key={message.id} className={`bubble-row ${from}`}>
                    <div className="message-bubble">
                      {(message.is_automated || message.is_ai_generated) && (
                        <span className="bot-label">
                          <Bot size={12} />
                          {message.is_automated ? 'AUTOMAÇÃO' : 'COPILOTO IA'}
                        </span>
                      )}
                      <p>{message.body || 'Mídia recebida'}</p>
                      {message.media_url && (
                        <a
                          className="message-media-link"
                          href={message.media_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir {message.message_type || 'mídia'}
                        </a>
                      )}
                      <time>
                        {timeLabel(message.created_at)} · {message.status}
                      </time>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="composer">
              <div className="composer-actions">
                <button
                  className="ai-button"
                  onClick={() => void suggest()}
                  disabled={busy === 'suggest' || !agentId || !selected.open24h}
                >
                  {busy === 'suggest' ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {agentId ? 'Sugerir com IA' : 'Configure um agente'}
                </button>
                {agents.length > 1 && (
                  <select
                    value={agentId}
                    onChange={(event) => setAgentId(event.target.value)}
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                )}
                {!selected.open24h &&
                  selected.platform === 'instagram' &&
                  selected.humanAgentEligible &&
                  !selected.optedOut && (
                    <button
                      className={`human-agent-toggle ${humanAgent ? 'active' : ''}`}
                      onClick={() => {
                        setHumanAgent((current) => !current)
                        setDraft('')
                        setDraftFromAi(false)
                        setAiSources([])
                        pendingSendKey.current = null
                      }}
                    >
                      {humanAgent
                        ? 'HUMAN_AGENT ativo'
                        : 'Assumir atendimento humano'}
                    </button>
                  )}
              </div>
              {requiresWhatsAppTemplate && (
                <div className="whatsapp-template-composer">
                  <label>
                    Template aprovado
                    <select
                      value={templateId}
                      onChange={(event) => {
                        setTemplateId(event.target.value)
                        pendingSendKey.current = null
                      }}
                    >
                      {whatsappTemplates.length === 0 && (
                        <option value="">
                          Sincronize templates em Configurações
                        </option>
                      )}
                      {whatsappTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} · {template.language}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Componentes/variáveis JSON
                    <textarea
                      value={templateComponents}
                      onChange={(event) => {
                        setTemplateComponents(event.target.value)
                        pendingSendKey.current = null
                      }}
                      spellCheck={false}
                      placeholder='Ex.: [{"type":"body","parameters":[{"type":"text","text":"Ana"}]}]'
                    />
                    <small>
                      Use <code>[]</code> quando o template não tiver variáveis.
                    </small>
                  </label>
                </div>
              )}
              {mediaOpen && !requiresWhatsAppTemplate && (
                <div className="inbox-tool-panel">
                  <label>
                    Tipo de mídia
                    <select
                      value={mediaType}
                      onChange={(event) =>
                        setMediaType(event.target.value as 'image' | 'video')
                      }
                    >
                      <option value="image">Imagem</option>
                      <option value="video">Vídeo</option>
                    </select>
                  </label>
                  <label>
                    URL HTTPS pública
                    <input
                      type="url"
                      value={mediaUrl}
                      onChange={(event) => {
                        setMediaUrl(event.target.value)
                        pendingSendKey.current = null
                      }}
                      placeholder="https://cdn.exemplo.com/midia.jpg"
                    />
                  </label>
                  <small>
                    {selected.platform === 'instagram'
                      ? 'O Instagram envia a mídia sem legenda; envie o texto separadamente se necessário.'
                      : 'No WhatsApp, o texto digitado será usado como legenda.'}
                  </small>
                </div>
              )}
              {tagOpen && (
                <div className="inbox-tool-panel inbox-tag-panel">
                  <strong>Tags deste contato</strong>
                  {catalogTags.length ? (
                    <div>
                      {catalogTags.map((tag) => (
                        <label key={tag.id}>
                          <input
                            type="checkbox"
                            checked={contactTagIds.includes(tag.id)}
                            disabled={tagsBusy}
                            onChange={() => void toggleContactTag(tag.id)}
                          />
                          <i style={{ background: tag.color }} /> {tag.name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <small>Crie tags em Contatos &amp; tags.</small>
                  )}
                </div>
              )}
              <div className="composer-box">
                <textarea
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setDraftFromAi(false)
                    setAiSources([])
                    pendingSendKey.current = null
                  }}
                  placeholder={
                    requiresWhatsAppTemplate
                      ? 'O conteúdo vem do template aprovado'
                      : canCompose
                        ? 'Escreva no papo reto…'
                        : 'Envio bloqueado pela janela Meta'
                  }
                  disabled={!canCompose || requiresWhatsAppTemplate}
                />
                <div>
                  <button
                    className="icon-button"
                    onClick={() => {
                      setMediaOpen((current) => !current)
                      setTagOpen(false)
                    }}
                    disabled={!canCompose || requiresWhatsAppTemplate}
                    title="Anexar mídia por URL HTTPS"
                    aria-label="Anexar mídia"
                  >
                    <Paperclip size={18} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => {
                      setMediaOpen(false)
                      void openTags()
                    }}
                    disabled={tagsBusy}
                    title="Gerenciar tags do contato"
                    aria-label="Gerenciar tags do contato"
                  >
                    <Tag size={18} />
                  </button>
                  <button
                    className="send-button"
                    onClick={() => void sendMessage()}
                    disabled={
                      !canCompose ||
                      (!requiresWhatsAppTemplate &&
                        !draft.trim() &&
                        !mediaUrl.trim()) ||
                      (requiresWhatsAppTemplate && !selectedTemplate) ||
                      busy === 'send'
                    }
                  >
                    {busy === 'send' ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Send size={17} />
                    )}
                  </button>
                </div>
              </div>
              <small className="optout-note">
                <Info size={13} />{' '}
                {selected.platform === 'whatsapp'
                  ? 'Texto livre exige janela de 24h; fora dela, somente template APPROVED.'
                  : 'Automação inclui “Responda PARAR”; HUMAN_AGENT nunca usa IA.'}
              </small>
              {draftFromAi && aiSources.length > 0 && (
                <div className="ai-source-strip">
                  <BookOpen size={13} />
                  <span>Fontes consultadas:</span>
                  {aiSources.map((source) =>
                    source.sourceUrl ? (
                      <a
                        key={source.id}
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.title}
                      </a>
                    ) : (
                      <em key={source.id}>{source.title}</em>
                    ),
                  )}
                </div>
              )}
              {error && <small className="inbox-error">{error}</small>}
            </div>
          </>
        ) : (
          <div className="inbox-no-selection">
            <Bot size={30} />
            <h3>Inbox pronta para receber</h3>
            <p>
              {error || 'A primeira conversa aparecerá após um webhook real.'}
            </p>
          </div>
        )}
      </section>

      <aside className="contact-panel">
        {selected ? (
          <>
            <span className="avatar avatar-xl">{initials(selected.name)}</span>
            <h3>{selected.name}</h3>
            <p>
              {selected.platform === 'whatsapp'
                ? selected.username
                : `@${selected.username}`}
            </p>
            <div className="contact-status">
              <StatusDot tone={selected.open24h ? 'green' : 'orange'}>
                {selected.open24h ? 'Janela aberta' : 'Fora de 24h'}
              </StatusDot>
            </div>
            <div className="conversation-controls">
              <label>
                <CheckCircle2 size={14} /> Status
                <select
                  value={selected.status}
                  onChange={(event) =>
                    void updateConversation({
                      status: event.target.value as Conversation['status'],
                    })
                  }
                >
                  <option value="open">Aberta</option>
                  <option value="pending">Pendente</option>
                  <option value="resolved">Resolvida</option>
                </select>
              </label>
              <label>
                <Flag size={14} /> Prioridade
                <select
                  value={selected.priority}
                  onChange={(event) =>
                    void updateConversation({
                      priority: event.target.value as Conversation['priority'],
                    })
                  }
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </label>
            </div>
            <div className="info-block">
              <span>AGENTE AUTÔNOMO</span>
              <Switch
                checked={selected.aiEnabled}
                label="Permitir agente autônomo"
                onChange={() => void toggleAi()}
              />
            </div>
            <div className="inbox-notes">
              <span className="inbox-notes-title">
                <StickyNote size={14} /> NOTAS INTERNAS
              </span>
              <div className="note-composer">
                <textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Contexto para a equipe…"
                  maxLength={2000}
                />
                <button
                  className="button button-dark button-full"
                  onClick={() => void addNote()}
                  disabled={!noteDraft.trim() || busy === 'note'}
                >
                  Adicionar nota
                </button>
              </div>
              <div className="note-list">
                {notes.map((note) => (
                  <article key={note.id}>
                    <p>{note.body}</p>
                    <footer>
                      <span>
                        {note.author_user_id === currentUserId
                          ? 'Você'
                          : 'Equipe'}{' '}
                        · {timeLabel(note.created_at)}
                      </span>
                      {note.author_user_id === currentUserId && (
                        <button
                          className="icon-button"
                          onClick={() => void deleteNote(note.id)}
                          aria-label="Excluir nota"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </footer>
                  </article>
                ))}
                {notes.length === 0 && <small>Nenhuma nota interna.</small>}
              </div>
            </div>
            <div className="info-block">
              <span>COMPLIANCE</span>
              <small>
                {selected.optedOut ? 'Opt-out registrado' : 'Sem opt-out'}
              </small>
              <small>
                {selected.platform === 'whatsapp'
                  ? selected.open24h
                    ? 'Texto livre elegível em 24h'
                    : 'Exige template aprovado'
                  : selected.humanAgentEligible
                    ? 'HUMAN_AGENT até 7d elegível'
                    : 'HUMAN_AGENT indisponível'}
              </small>
            </div>
            <div className="info-block">
              <span>DADOS</span>
              <small>
                Primeiro contato:{' '}
                {selected.firstSeenAt
                  ? new Date(selected.firstSeenAt).toLocaleDateString('pt-BR')
                  : '—'}
              </small>
              <small>{messages.length} mensagens carregadas</small>
            </div>
          </>
        ) : (
          <p className="inbox-empty">Selecione uma conversa.</p>
        )}
      </aside>
    </div>
  )
}
