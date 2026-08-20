/** Página pública, acessível e responsiva de agendamento de leads. */
import { createFileRoute } from '@tanstack/react-router'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ArrowLeft,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  ShieldCheck,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { seoHead } from '../../lib/seo'

type Slot = {
  startAt: string
  endAt: string
  localDate: string
  localTime: string
}

type PublicCalendar = {
  page: {
    title: string
    description: string | null
    durationMinutes: number
    timezone: string
    requirePhone: boolean
    createMeet: boolean
  }
  slots: Slot[]
}

export const Route = createFileRoute('/agendar/$slug')({
  head: ({ params }) =>
    seoHead({
      title: 'Agendar uma conversa',
      description:
        'Escolha um horário disponível e confirme sua reunião com segurança pelo Wal Chat.',
      path: `/agendar/${encodeURIComponent(params.slug)}`,
      noindex: true,
    }),
  component: PublicBookingPage,
})

function groupSlots(slots: Slot[]) {
  const groups = new Map<string, Slot[]>()
  for (const slot of slots)
    groups.set(slot.localDate, [...(groups.get(slot.localDate) ?? []), slot])
  return groups
}

function zonedLabel(
  iso: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    ...options,
  }).format(new Date(iso))
}

function PublicBookingPage() {
  const { slug } = Route.useParams()
  const [calendar, setCalendar] = useState<PublicCalendar | null>(null)
  const [selected, setSelected] = useState<Slot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{
    startAt: string
    endAt: string
    timezone: string
    meetUrl: string | null
    message: string | null
  } | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/public/bookings/${encodeURIComponent(slug)}`,
      )
      const payload = (await response.json()) as PublicCalendar & {
        error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? 'Agenda indisponível.')
      setCalendar(payload)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Agenda indisponível.',
      )
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => void load(), [load])

  const grouped = useMemo(
    () => groupSlots(calendar?.slots ?? []),
    [calendar?.slots],
  )

  async function confirm() {
    if (!selected || !name.trim() || !email.trim()) return
    if (calendar?.page.requirePhone && !phone.trim()) {
      setError('Informe seu telefone para continuar.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/public/bookings/${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startAt: selected.startAt,
            name,
            email,
            phone: phone || null,
            notes: notes || null,
            idempotencyKey,
            source: 'public_page',
          }),
        },
      )
      const payload = (await response.json()) as {
        error?: string
        booking?: {
          startAt: string
          endAt: string
          timezone: string
          meetUrl: string | null
        }
        confirmationMessage?: string | null
        warning?: string | null
      }
      if (!response.ok || !payload.booking)
        throw new Error(payload.error ?? 'Não foi possível confirmar.')
      setConfirmation({
        ...payload.booking,
        message: payload.warning ?? payload.confirmationMessage ?? null,
      })
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível confirmar.',
      )
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (confirmation)
    return (
      <main className="public-booking-page confirmed">
        <section className="public-booking-confirmation">
          <span className="booking-success-icon">
            <CheckCircle2 size={36} />
          </span>
          <small>HORÁRIO CONFIRMADO</small>
          <h1>Fechou. Está na agenda.</h1>
          <p>
            {confirmation.message ?? 'Você receberá os detalhes no convite.'}
          </p>
          <div className="booking-confirmed-time">
            <CalendarCheck2 size={20} />
            <div>
              <strong>
                {zonedLabel(confirmation.startAt, confirmation.timezone, {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                })}
              </strong>
              <span>
                {zonedLabel(confirmation.startAt, confirmation.timezone, {
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                })}
                –
                {zonedLabel(confirmation.endAt, confirmation.timezone, {
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                })}{' '}
                · {confirmation.timezone}
              </span>
            </div>
          </div>
          {confirmation.meetUrl && (
            <a
              className="button button-dark"
              href={confirmation.meetUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Video size={17} /> Abrir Google Meet
            </a>
          )}
          <span className="booking-powered">
            Agendamento seguro por WAL CHAT
          </span>
        </section>
      </main>
    )

  return (
    <main className="public-booking-page">
      <header className="public-booking-brand">
        <span className="brand-mark">W</span>
        <strong>WAL CHAT</strong>
        <span>
          <ShieldCheck size={14} /> Agenda protegida
        </span>
      </header>
      <div className="public-booking-shell">
        <aside>
          <small>VAMOS TROCAR UMA IDEIA</small>
          <h1>{calendar?.page.title ?? 'Escolha seu horário.'}</h1>
          <p>
            {calendar?.page.description ??
              'Selecione um horário livre e confirme seus dados.'}
          </p>
          {calendar && (
            <div className="public-booking-meta">
              <span>
                <Clock3 size={17} /> {calendar.page.durationMinutes} minutos
              </span>
              {calendar.page.createMeet && (
                <span>
                  <Video size={17} /> Google Meet automático
                </span>
              )}
              <span>
                <ShieldCheck size={17} /> Horários validados em tempo real
              </span>
            </div>
          )}
        </aside>
        <section className="public-booking-picker">
          {loading ? (
            <div className="public-booking-loading">
              <LoaderCircle className="spin" size={25} /> Buscando horários…
            </div>
          ) : error && !calendar ? (
            <div className="public-booking-loading error">
              <strong>Agenda indisponível</strong>
              <p>{error}</p>
              <button
                className="button button-outline"
                onClick={() => void load()}
              >
                Tentar novamente
              </button>
            </div>
          ) : !selected ? (
            <>
              <header>
                <div>
                  <span>1</span>
                  <strong>Escolha o melhor horário</strong>
                </div>
                <small>{calendar?.page.timezone}</small>
              </header>
              <div className="public-slot-days">
                {Array.from(grouped.entries()).map(([day, slots]) => (
                  <section key={day}>
                    <h2>
                      {format(parseISO(day), "EEE, dd 'de' MMM", {
                        locale: ptBR,
                      })}
                    </h2>
                    <div>
                      {slots.map((slot) => (
                        <button
                          key={slot.startAt}
                          onClick={() => setSelected(slot)}
                        >
                          {slot.localTime}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {grouped.size === 0 && (
                  <div className="public-booking-loading">
                    <strong>Sem horários neste período</strong>
                    <p>Tente novamente mais tarde ou fale com a equipe.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <form
              className="public-booking-form"
              onSubmit={(event) => {
                event.preventDefault()
                void confirm()
              }}
            >
              <button
                type="button"
                className="text-button booking-back"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft size={15} /> Trocar horário
              </button>
              <div className="selected-public-slot">
                <CalendarCheck2 size={20} />
                <div>
                  <strong>
                    {format(
                      parseISO(selected.localDate),
                      "EEEE, dd 'de' MMMM",
                      {
                        locale: ptBR,
                      },
                    )}
                  </strong>
                  <span>
                    {selected.localTime} · {calendar?.page.durationMinutes} min
                  </span>
                </div>
              </div>
              <label className="form-field">
                <span>Seu nome *</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={120}
                  autoFocus
                />
              </label>
              <label className="form-field">
                <span>Seu email *</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={254}
                />
              </label>
              <label className="form-field">
                <span>
                  Telefone {calendar?.page.requirePhone ? '*' : '(opcional)'}
                </span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required={calendar?.page.requirePhone}
                  maxLength={30}
                />
              </label>
              <label className="form-field">
                <span>O que você quer conversar? (opcional)</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button
                className="button button-dark"
                type="submit"
                disabled={saving || !name.trim() || !email.trim()}
              >
                {saving ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <CalendarCheck2 size={17} />
                )}{' '}
                Confirmar horário
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
