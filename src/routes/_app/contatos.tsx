/** CRM leve com tags, busca, elegibilidade e exportação local em CSV. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Download,
  Filter,
  Plus,
  Search,
  Tags,
  UserRoundCheck,
} from 'lucide-react'
import { contacts } from '../../lib/demo-data'
import { Avatar, PageIntro, StatusDot } from '../../components/ui'

export const Route = createFileRoute('/_app/contatos')({
  component: ContactsPage,
})

function ContactsPage() {
  /** Escapa campos e produz um Blob sem enviar a lista a serviços externos. */
  function exportCsv() {
    const rows = [
      ['nome', 'instagram', 'tags', 'ultima_interacao', 'elegibilidade'],
      ...contacts.map((contact) => [
        contact.name,
        contact.user,
        contact.tags.join('|'),
        contact.last,
        contact.status,
      ]),
    ]
    const blob = new Blob(
      [rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')],
      { type: 'text/csv;charset=utf-8' },
    )
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'wal-chat-contatos.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="Sua base, do seu jeito."
        description="Organize quem chegou, entenda o momento e converse sem spam."
        actions={
          <>
            <button className="button button-outline" onClick={exportCsv}>
              <Download size={16} /> Exportar CSV
            </button>
            <button className="button button-dark">
              <Plus size={16} /> Novo contato
            </button>
          </>
        }
      />
      <div className="mini-stats">
        <div>
          <UserRoundCheck size={19} />
          <span>
            <strong>1.842</strong>
            <small>contatos totais</small>
          </span>
        </div>
        <div>
          <Tags size={19} />
          <span>
            <strong>12</strong>
            <small>tags ativas</small>
          </span>
        </div>
        <div>
          <span className="pulse-dot" />
          <span>
            <strong>235</strong>
            <small>novos em 7 dias</small>
          </span>
        </div>
      </div>
      <section className="card table-card">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input placeholder="Buscar nome ou @…" />
          </label>
          <button className="button button-outline">
            <Filter size={15} /> Filtrar
          </button>
        </div>
        <div className="data-table contacts-table">
          <div className="table-row table-head">
            <span>CONTATO</span>
            <span>TAGS</span>
            <span>ÚLTIMA INTERAÇÃO</span>
            <span>ELEGIBILIDADE</span>
            <span />
          </div>
          {contacts.map((contact) => (
            <div className="table-row" key={contact.user}>
              <span className="person-cell">
                <Avatar name={contact.name} color={contact.color} />
                <span>
                  <strong>{contact.name}</strong>
                  <small>{contact.user}</small>
                </span>
              </span>
              <span className="tag-list">
                {contact.tags.map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </span>
              <span>{contact.last}</span>
              <StatusDot
                tone={
                  contact.status === '24h aberta'
                    ? 'green'
                    : contact.status === 'HUMAN_AGENT'
                      ? 'orange'
                      : 'gray'
                }
              >
                {contact.status}
              </StatusDot>
              <button className="text-button">Abrir</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
