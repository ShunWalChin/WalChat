/** CRM multicanal com busca, tags, elegibilidade Meta e exportação CSV. */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Download,
  LoaderCircle,
  MessageSquareText,
  Search,
  Tags,
  UserRoundCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Avatar, PageIntro, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

type Contact = {
  id: string
  platform: 'instagram' | 'whatsapp'
  name: string
  identity: string
  avatarUrl: string | null
  lastInteractionAt: string | null
  firstSeenAt: string
  tags: Array<{ id: string; name: string; color: string }>
  eligibility: {
    policy: string
    label: string
    tone: 'green' | 'orange' | 'gray' | 'red' | 'blue'
  }
}

type ContactsResponse = {
  contacts: Contact[]
  summary: { total: number; new7d: number; tags: number }
}

export const Route = createFileRoute('/_app/contatos')({
  component: ContactsPage,
})

function ContactsPage() {
  const [data, setData] = useState<ContactsResponse | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await apiFetch<ContactsResponse>('/api/contacts?limit=500'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return data?.contacts ?? []
    return (data?.contacts ?? []).filter((contact) =>
      `${contact.name} ${contact.identity}`
        .toLocaleLowerCase('pt-BR')
        .includes(term),
    )
  }, [data, search])

  function exportCsv() {
    const rows = [
      [
        'nome',
        'canal',
        'identidade',
        'tags',
        'ultima_interacao',
        'elegibilidade',
      ],
      ...visible.map((contact) => [
        contact.name,
        contact.platform,
        contact.identity,
        contact.tags.map((tag) => tag.name).join('|'),
        contact.lastInteractionAt ?? '',
        contact.eligibility.policy,
      ]),
    ]
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','),
      )
      .join('\n')
    const blob = new Blob([`\uFEFF${csv}`], {
      type: 'text/csv;charset=utf-8',
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'wal-chat-contatos.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="Sua base multicanal, do seu jeito."
        description="Instagram e WhatsApp entram no mesmo CRM, preservando a elegibilidade de cada canal."
        actions={
          <>
            <button
              className="button button-outline"
              onClick={exportCsv}
              disabled={!visible.length}
            >
              <Download size={16} /> Exportar CSV
            </button>
            <Link to="/inbox" className="button button-dark">
              <MessageSquareText size={16} /> Abrir Inbox
            </Link>
          </>
        }
      />
      <div className="mini-stats">
        <div>
          <UserRoundCheck size={19} />
          <span>
            <strong>{data?.summary.total ?? '—'}</strong>
            <small>contatos totais</small>
          </span>
        </div>
        <div>
          <Tags size={19} />
          <span>
            <strong>{data?.summary.tags ?? '—'}</strong>
            <small>tags ativas</small>
          </span>
        </div>
        <div>
          <span className="pulse-dot" />
          <span>
            <strong>{data?.summary.new7d ?? '—'}</strong>
            <small>novos em 7 dias</small>
          </span>
        </div>
      </div>
      <section className="card table-card">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              placeholder="Buscar nome, @ ou telefone…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="table-result-count">
            {visible.length} contato(s) carregado(s)
          </span>
        </div>
        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="table-empty">
            <LoaderCircle className="spin" size={18} /> Carregando contatos…
          </div>
        ) : (
          <div className="data-table contacts-table">
            <div className="table-row table-head">
              <span>CONTATO</span>
              <span>TAGS</span>
              <span>ÚLTIMA INTERAÇÃO</span>
              <span>ELEGIBILIDADE</span>
              <span />
            </div>
            {visible.map((contact) => (
              <div className="table-row" key={contact.id}>
                <span className="person-cell">
                  <Avatar
                    name={contact.name}
                    color={
                      contact.platform === 'whatsapp' ? '#1d7a55' : '#f05a28'
                    }
                  />
                  <span>
                    <strong>{contact.name}</strong>
                    <small>
                      <em className={`channel-badge ${contact.platform}`}>
                        {contact.platform === 'whatsapp' ? 'WA' : 'IG'}
                      </em>{' '}
                      {contact.identity}
                    </small>
                  </span>
                </span>
                <span className="tag-list">
                  {contact.tags.map((tag) => (
                    <em key={tag.id}>{tag.name}</em>
                  ))}
                  {!contact.tags.length && <small>Sem tags</small>}
                </span>
                <span>
                  {contact.lastInteractionAt
                    ? new Date(contact.lastInteractionAt).toLocaleString(
                        'pt-BR',
                      )
                    : 'Sem interação'}
                </span>
                <StatusDot tone={contact.eligibility.tone}>
                  {contact.eligibility.label}
                </StatusDot>
                <Link to="/inbox" className="text-button">
                  Abrir
                </Link>
              </div>
            ))}
            {!visible.length && (
              <div className="table-empty">Nenhum contato encontrado.</div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
