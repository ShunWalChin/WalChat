/** Inbox unificada com categorias, janela Meta, contexto do contato e copiloto de IA. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Bot,
  Clock3,
  Info,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Tag,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { conversations, messages as seedMessages } from '../../lib/demo-data'
import { StatusDot } from '../../components/ui'

export const Route = createFileRoute('/_app/inbox')({ component: InboxPage })

type ChatMessage = { id: number; from: string; body: string; time: string }

function InboxPage() {
  const [tab, setTab] = useState('principal')
  const [selectedId, setSelectedId] = useState('ana')
  const [messages, setMessages] = useState<ChatMessage[]>(seedMessages)
  const [draft, setDraft] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    conversations[0]
  const visible = useMemo(
    () =>
      conversations.filter(
        (conversation) => tab === 'todos' || conversation.category === tab,
      ),
    [tab],
  )

  /** Preenche o composer; sugerir nunca envia automaticamente. */
  function suggest() {
    setSuggesting(true)
    window.setTimeout(() => {
      setDraft(
        'Fechou, Ana! Aqui está o link do guia: https://wal-chat.64.181.178.125.nip.io/guia — se pintar qualquer dúvida, chama por aqui 👊\n\nResponda PARAR',
      )
      setSuggesting(false)
    }, 650)
  }

  /** Simula o envio na UI e garante o opt-out no texto automático sugerido. */
  function sendMessage() {
    if (!draft.trim() || !selected.open) return
    setMessages((current) => [
      ...current,
      { id: Date.now(), from: 'me', body: draft, time: 'agora' },
    ])
    setDraft('')
  }

  return (
    <div className="inbox-shell">
      <section className="conversation-list">
        <div className="inbox-tabs">
          {['principal', 'geral', 'pedidos', 'ia_off'].map((item) => (
            <button
              key={item}
              className={tab === item ? 'active' : ''}
              onClick={() => setTab(item)}
            >
              {item === 'ia_off' ? 'IA off' : item}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input placeholder="Buscar conversa…" />
        </label>
        <div className="conversation-scroll">
          {visible.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-row ${selectedId === conversation.id ? 'active' : ''}`}
              onClick={() => setSelectedId(conversation.id)}
            >
              <span
                className="avatar"
                style={{ background: conversation.color }}
              >
                {conversation.initials}
              </span>
              <span className="conversation-copy">
                <strong>
                  {conversation.name}
                  <time>{conversation.time}</time>
                </strong>
                <small>{conversation.user}</small>
                <p>{conversation.preview}</p>
              </span>
              {conversation.unread > 0 && <em>{conversation.unread}</em>}
            </button>
          ))}
        </div>
      </section>

      <section className="chat-panel">
        <header className="chat-header">
          <span className="avatar" style={{ background: selected.color }}>
            {selected.initials}
          </span>
          <div>
            <strong>{selected.name}</strong>
            <small>{selected.user}</small>
          </div>
          <span className={`window-badge ${selected.open ? 'open' : 'closed'}`}>
            <Clock3 size={14} />
            {selected.open ? '23h 42min restantes' : 'Janela 24h fechada'}
          </span>
          <button className="icon-button">
            <MoreHorizontal size={20} />
          </button>
        </header>
        {!selected.open && (
          <div className="window-warning">
            <ShieldAlert size={17} />
            <span>
              Envio automático bloqueado. Disponível somente para atendimento
              humano elegível em até 7 dias.
            </span>
          </div>
        )}
        <div className="messages-scroll">
          <div className="day-separator">
            <span>HOJE</span>
          </div>
          {messages.map((message) => (
            <div key={message.id} className={`bubble-row ${message.from}`}>
              <div className="message-bubble">
                {message.from === 'bot' && (
                  <span className="bot-label">
                    <Bot size={12} /> AUTOMAÇÃO
                  </span>
                )}
                <p>{message.body}</p>
                <time>{message.time}</time>
              </div>
            </div>
          ))}
        </div>
        <div className="composer">
          <div className="composer-actions">
            <button
              className="ai-button"
              onClick={suggest}
              disabled={suggesting}
            >
              <Sparkles size={15} />
              {suggesting ? 'Pensando…' : 'Sugerir com IA'}
            </button>
            <span>A IA usa as últimas 5 mensagens + sua base.</span>
          </div>
          <div className="composer-box">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                selected.open
                  ? 'Escreva no papo reto…'
                  : 'Janela de envio fechada'
              }
              disabled={!selected.open}
            />
            <div>
              <button className="icon-button">
                <Paperclip size={18} />
              </button>
              <button className="icon-button">
                <Tag size={18} />
              </button>
              <button
                className="send-button"
                onClick={sendMessage}
                disabled={!selected.open || !draft.trim()}
              >
                <Send size={17} />
              </button>
            </div>
          </div>
          <small className="optout-note">
            <Info size={13} />
            Mensagens automáticas sempre recebem “Responda PARAR”.
          </small>
        </div>
      </section>

      <aside className="contact-panel">
        <span
          className="avatar avatar-xl"
          style={{ background: selected.color }}
        >
          {selected.initials}
        </span>
        <h3>{selected.name}</h3>
        <p>{selected.user}</p>
        <div className="contact-status">
          <StatusDot tone={selected.open ? 'green' : 'orange'}>
            {selected.open ? 'Janela aberta' : 'Atendimento humano'}
          </StatusDot>
        </div>
        <div className="info-block">
          <span>TAGS</span>
          <div className="tag-list">
            <em>Lead quente</em>
            <em>Veio do Reels</em>
            <button>+</button>
          </div>
        </div>
        <div className="info-block">
          <span>ORIGEM</span>
          <strong>Reel — 3 erros de creator</strong>
          <small>Comentou “quero”</small>
        </div>
        <div className="info-block">
          <span>DADOS</span>
          <small>Primeiro contato: 14 jul 2026</small>
          <small>8 mensagens · 1 sequência</small>
        </div>
      </aside>
    </div>
  )
}
