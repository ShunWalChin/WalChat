/** Equipe, disponibilidade, capacidade e estratégia de distribuição. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Gauge,
  LoaderCircle,
  RefreshCw,
  Save,
  UsersRound,
  X,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Avatar, PageIntro, StatusDot, Switch } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'
import './deskcomm.css'

type TeamData = {
  members: Array<{
    id: string
    name: string
    role: string
    isCurrentUser: boolean
    openConversations: number
    availability: {
      is_available: boolean
      capacity: number
      last_heartbeat_at: string | null
    }
  }>
  routing: {
    routing_strategy: 'round_robin' | 'least_loaded' | 'manual'
    max_open_conversations: number
    business_hours: {
      timezone: string
      weekdays: number[]
      start: string
      end: string
    }
  }
  permissions: { canManage: boolean }
}

export const Route = createFileRoute('/_app/equipe')({ component: TeamPage })

function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savingRouting, setSavingRouting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await apiFetch<TeamData>('/api/team'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => void load(), [load])

  async function updateAvailability(
    member: TeamData['members'][number],
    patch: { isAvailable?: boolean; capacity?: number },
  ) {
    setBusyId(member.id)
    try {
      await apiFetch('/api/team', {
        method: 'PATCH',
        body: JSON.stringify({
          kind: 'availability',
          userId: member.id,
          isAvailable: patch.isAvailable ?? member.availability.is_available,
          capacity: patch.capacity ?? member.availability.capacity,
        }),
      })
      setFeedback(`Disponibilidade de ${member.name} atualizada.`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao atualizar.')
    } finally {
      setBusyId(null)
    }
  }

  async function saveRouting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    const form = new FormData(event.currentTarget)
    setSavingRouting(true)
    try {
      await apiFetch('/api/team', {
        method: 'PATCH',
        body: JSON.stringify({
          kind: 'routing',
          strategy: String(form.get('strategy')),
          maxOpenConversations: Number(form.get('maxOpenConversations')),
          businessHours: {
            ...data.routing.business_hours,
            start: String(form.get('start')),
            end: String(form.get('end')),
          },
        }),
      })
      setFeedback('Estratégia de distribuição salva.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar.')
    } finally {
      setSavingRouting(false)
    }
  }

  const online =
    data?.members.filter((member) => member.availability.is_available).length ??
    0
  const capacity =
    data?.members.reduce(
      (total, member) =>
        total +
        (member.availability.is_available ? member.availability.capacity : 0),
      0,
    ) ?? 0
  const active =
    data?.members.reduce(
      (total, member) => total + member.openConversations,
      0,
    ) ?? 0

  return (
    <div className="stack-lg deskcomm-page">
      <PageIntro
        title="Distribuição visível, capacidade respeitada."
        description="Saiba quem está disponível, limite a carga por atendente e escolha como novas conversas são distribuídas."
        actions={
          <button
            className="button button-outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'spin' : ''} size={16} /> Atualizar
          </button>
        }
      />
      <div className="mini-stats deskcomm-stats">
        <TeamStat value={data?.members.length ?? 0} label="membros" />
        <TeamStat value={online} label="disponíveis" />
        <TeamStat value={capacity} label="capacidade online" />
        <TeamStat value={active} label="conversas atribuídas" />
      </div>
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

      <div className="deskcomm-two-columns">
        <section className="card team-members-card">
          <header className="deskcomm-section-header">
            <div>
              <strong>Equipe</strong>
              <span>Status e carga atual por pessoa</span>
            </div>
            <UsersRound size={19} />
          </header>
          {loading && !data ? (
            <div className="deskcomm-loading">
              <LoaderCircle className="spin" /> Carregando equipe…
            </div>
          ) : (
            <div className="team-member-list">
              {data?.members.map((member) => {
                const canEdit =
                  data.permissions.canManage || member.isCurrentUser
                return (
                  <article className="team-member-row" key={member.id}>
                    <Avatar
                      name={member.name}
                      color={
                        member.availability.is_available ? '#176c45' : '#5f5c55'
                      }
                    />
                    <div className="team-member-main">
                      <strong>
                        {member.name}
                        {member.isCurrentUser ? ' · você' : ''}
                      </strong>
                      <span>
                        {roleLabel(member.role)} · {member.openConversations}{' '}
                        conversa(s)
                      </span>
                    </div>
                    <StatusDot
                      tone={member.availability.is_available ? 'green' : 'gray'}
                    >
                      {member.availability.is_available
                        ? 'Disponível'
                        : 'Offline'}
                    </StatusDot>
                    <label className="team-capacity">
                      <span>Capacidade</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={member.availability.capacity}
                        disabled={!canEdit || busyId === member.id}
                        onChange={(event) => {
                          const value = Number(event.target.value)
                          setData((current) =>
                            current
                              ? {
                                  ...current,
                                  members: current.members.map((item) =>
                                    item.id === member.id
                                      ? {
                                          ...item,
                                          availability: {
                                            ...item.availability,
                                            capacity: value,
                                          },
                                        }
                                      : item,
                                  ),
                                }
                              : current,
                          )
                        }}
                        onBlur={(event) => {
                          const next = Number(event.target.value)
                          if (next >= 1 && next <= 100)
                            void updateAvailability(member, { capacity: next })
                        }}
                      />
                    </label>
                    <Switch
                      checked={member.availability.is_available}
                      label={`Disponibilidade de ${member.name}`}
                      disabled={!canEdit || busyId === member.id}
                      onChange={() =>
                        void updateAvailability(member, {
                          isAvailable: !member.availability.is_available,
                        })
                      }
                    />
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="card team-routing-card">
          <header className="deskcomm-section-header">
            <div>
              <strong>Distribuição automática</strong>
              <span>Aplicada às novas conversas elegíveis</span>
            </div>
            <Gauge size={19} />
          </header>
          {data && (
            <form className="deskcomm-form" onSubmit={saveRouting}>
              <label>
                Estratégia
                <select
                  name="strategy"
                  defaultValue={data.routing.routing_strategy}
                  disabled={!data.permissions.canManage}
                >
                  <option value="round_robin">Rodízio equilibrado</option>
                  <option value="least_loaded">Menor carga primeiro</option>
                  <option value="manual">Atribuição manual</option>
                </select>
              </label>
              <label>
                Limite global por atendente
                <input
                  name="maxOpenConversations"
                  type="number"
                  min="1"
                  max="500"
                  defaultValue={data.routing.max_open_conversations}
                  disabled={!data.permissions.canManage}
                />
              </label>
              <div className="deskcomm-form-grid">
                <label>
                  Início do expediente
                  <input
                    name="start"
                    type="time"
                    defaultValue={data.routing.business_hours.start}
                    disabled={!data.permissions.canManage}
                  />
                </label>
                <label>
                  Fim do expediente
                  <input
                    name="end"
                    type="time"
                    defaultValue={data.routing.business_hours.end}
                    disabled={!data.permissions.canManage}
                  />
                </label>
              </div>
              <p className="field-help">
                Fuso: {data.routing.business_hours.timezone}. Disponibilidade,
                horário e capacidade precisam estar válidos ao mesmo tempo.
              </p>
              {data.permissions.canManage && (
                <button className="button button-dark" disabled={savingRouting}>
                  {savingRouting ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Save size={16} />
                  )}{' '}
                  Salvar distribuição
                </button>
              )}
            </form>
          )}
        </section>
      </div>
    </div>
  )
}

function TeamStat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <UsersRound size={18} />
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  )
}

function roleLabel(role: string) {
  return (
    {
      owner: 'Titular',
      admin: 'Administrador',
      agent: 'Atendente',
      viewer: 'Leitor',
    }[role] ?? role
  )
}
