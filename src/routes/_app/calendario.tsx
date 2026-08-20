/** Calendário operacional integrado ao Google, CRM, conteúdo e automações. */
import { createFileRoute } from '@tanstack/react-router'
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Cloud,
  Copy,
  ExternalLink,
  Link2,
  ListTodo,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { PageIntro, StatusDot } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

const searchSchema = z.object({
  view: z.enum(['month', 'week', 'agenda']).catch('month'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  source: z
    .enum(['all', 'calendar', 'task', 'booking', 'content', 'automation'])
    .catch('all'),
})

export const Route = createFileRoute('/_app/calendario')({
  validateSearch: searchSchema,
  component: CalendarPage,
})

type CalendarEvent = {
  id: string
  provider: 'local' | 'google' | 'system'
  provider_event_id: string | null
  calendar_connection_id: string | null
  event_type: string
  title: string
  description: string | null
  start_at: string
  end_at: string
  all_day: boolean
  timezone: string
  status: string
  location: string | null
  meet_url: string | null
  html_link: string | null
  attendees: Array<{ email: string; displayName?: string }>
  contact_id: string | null
  booking_id: string | null
}

type CalendarTask = {
  id: string
  provider: 'local' | 'google'
  calendar_connection_id: string | null
  title: string
  notes: string | null
  due_at: string | null
  completed_at: string | null
  status: string
  priority: string
  sync_status: string
  contact_id: string | null
}

type Booking = {
  id: string
  guest_name: string
  guest_email: string
  guest_phone: string | null
  start_at: string
  end_at: string
  timezone: string
  status: string
  meet_url: string | null
  booking_pages: { title?: string; slug?: string } | null
}

type Activity = {
  id: number
  source_type: string
  action: string
  title: string
  happened_at: string
}

type OperationalItem = {
  id: string
  source: string
  sourceId: string
  kind: string
  title: string
  status: string
  startAt: string
}

type BookingPage = {
  id: string
  title: string
  slug: string
  duration_minutes?: number
  durationMinutes?: number
  timezone: string
  is_active?: boolean
  isActive?: boolean
  create_meet?: boolean
  createMeet?: boolean
  publicUrl?: string
  description?: string | null
  availability?: Record<string, Array<{ start: string; end: string }>>
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
  minimumNoticeMinutes?: number
  maxAdvanceDays?: number
  requirePhone?: boolean
  confirmationMessage?: string | null
  connectionId?: string | null
  calendarId?: string
}

type ContactOption = {
  id: string
  display_name: string | null
  full_name: string | null
  username: string | null
  email: string | null
}

type CalendarPayload = {
  events: CalendarEvent[]
  tasks: CalendarTask[]
  bookings: Booking[]
  activities: Activity[]
  operationalItems: OperationalItem[]
  bookingPages: BookingPage[]
  contacts: ContactOption[]
  permissions: { canManage: boolean }
  summary: {
    events: number
    pendingTasks: number
    bookings: number
    operations: number
  }
}

type GoogleConnection = {
  id: string
  account_email: string | null
  display_name: string | null
  status: string
  selected_calendar_id: string
  selected_calendar_name: string | null
  selected_tasklist_id: string | null
  available_calendars: Array<{
    id: string
    summary: string
    primary?: boolean
    timeZone?: string
  }>
  available_tasklists: Array<{ id: string; title: string }>
  last_sync_at: string | null
  connection_error: string | null
  tokenStored: boolean
  refreshTokenStored: boolean
}

type GoogleStatus = {
  platformConfigured: boolean
  redirectUri: string
  requiredScopes: string[]
  connections: GoogleConnection[]
  permissions: { canConnect: boolean }
}

type CalendarItem = {
  id: string
  entity: 'event' | 'task' | 'booking' | 'operation'
  source: 'calendar' | 'task' | 'booking' | 'content' | 'automation'
  title: string
  startAt: string
  endAt?: string
  status: string
  icon: 'event' | 'meeting' | 'task' | 'booking' | 'content' | 'automation'
  raw: CalendarEvent | CalendarTask | Booking | OperationalItem
}

type EditorState =
  | { entity: 'event'; id?: string; date?: Date; value?: CalendarEvent }
  | { entity: 'task'; id?: string; date?: Date; value?: CalendarTask }

const weekdays = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM']

function contactName(contact: ContactOption) {
  return (
    contact.display_name ??
    contact.full_name ??
    (contact.username ? `@${contact.username}` : null) ??
    contact.email ??
    'Contato'
  )
}

function toLocalInput(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fromLocalInput(value: string) {
  return new Date(value).toISOString()
}

function addHoursInput(value: string, hours = 1) {
  return toLocalInput(
    new Date(new Date(value).getTime() + hours * 3_600_000).toISOString(),
  )
}

function viewRange(view: 'month' | 'week' | 'agenda', focus: Date) {
  if (view === 'month') {
    const from = startOfWeek(startOfMonth(focus), { weekStartsOn: 1 })
    const to = addDays(endOfWeek(endOfMonth(focus), { weekStartsOn: 1 }), 1)
    return { from, to }
  }
  if (view === 'week') {
    const from = startOfWeek(focus, { weekStartsOn: 1 })
    return { from, to: addDays(from, 7) }
  }
  return { from: focus, to: addDays(focus, 31) }
}

function itemTone(item: CalendarItem) {
  if (item.status === 'sync_error' || item.status === 'failed') return 'error'
  if (item.entity === 'booking') return 'booking'
  if (item.entity === 'task')
    return item.status === 'completed' ? 'done' : 'task'
  if (item.source === 'content') return 'content'
  if (item.source === 'automation') return 'automation'
  return item.icon === 'meeting' ? 'meeting' : 'event'
}

function groupByDate<T>(values: T[], dateFor: (value: T) => string) {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const key = dateFor(value)
    groups.set(key, [...(groups.get(key) ?? []), value])
  }
  return groups
}

function CalendarPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const focus = useMemo(
    () => parseISO(search.date ?? format(new Date(), 'yyyy-MM-dd')),
    [search.date],
  )
  const range = useMemo(
    () => viewRange(search.view, focus),
    [search.view, focus],
  )
  const [data, setData] = useState<CalendarPayload | null>(null)
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [calendar, googleStatus] = await Promise.all([
        apiFetch<CalendarPayload>(
          `/api/calendar?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`,
        ),
        apiFetch<GoogleStatus>('/api/integrations/google/status'),
      ])
      setData(calendar)
      setGoogle(googleStatus)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [range.from.getTime(), range.to.getTime()])

  useEffect(() => void load(), [load])

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('google')
    if (result === 'connected')
      setSuccess('Google Calendar e Tasks conectados com sucesso.')
    if (result === 'denied') setError('A conexão Google foi cancelada.')
    if (result === 'error')
      setError('O Google não concluiu a conexão. Confira a configuração OAuth.')
  }, [])

  const connection = google?.connections.find(
    (item) => item.status === 'connected' && item.tokenStored,
  )

  const items = useMemo<CalendarItem[]>(() => {
    if (!data) return []
    const values: CalendarItem[] = [
      ...data.events
        .filter((event) => !event.booking_id)
        .map((event) => ({
          id: `event:${event.id}`,
          entity: 'event' as const,
          source: 'calendar' as const,
          title: event.title,
          startAt: event.start_at,
          endAt: event.end_at,
          status: event.status,
          icon: event.meet_url ? ('meeting' as const) : ('event' as const),
          raw: event,
        })),
      ...data.tasks
        .filter((task) => task.due_at)
        .map((task) => ({
          id: `task:${task.id}`,
          entity: 'task' as const,
          source: 'task' as const,
          title: task.title,
          startAt: task.due_at as string,
          status: task.status,
          icon: 'task' as const,
          raw: task,
        })),
      ...data.bookings.map((booking) => ({
        id: `booking:${booking.id}`,
        entity: 'booking' as const,
        source: 'booking' as const,
        title: `${booking.booking_pages?.title ?? 'Reunião'} · ${booking.guest_name}`,
        startAt: booking.start_at,
        endAt: booking.end_at,
        status: booking.status,
        icon: 'booking' as const,
        raw: booking,
      })),
      ...data.operationalItems.map((item) => ({
        id: item.id,
        entity: 'operation' as const,
        source:
          item.source === 'content'
            ? ('content' as const)
            : ('automation' as const),
        title: item.title,
        startAt: item.startAt,
        status: item.status,
        icon:
          item.source === 'content'
            ? ('content' as const)
            : ('automation' as const),
        raw: item,
      })),
    ]
    return values
      .filter(
        (item) => search.source === 'all' || item.source === search.source,
      )
      .sort((left, right) => left.startAt.localeCompare(right.startAt))
  }, [data, search.source])

  function setSearch(changes: Partial<typeof search>) {
    void navigate({
      search: (current) => ({ ...current, ...changes }),
      replace: true,
    })
  }

  function move(direction: -1 | 1) {
    const next =
      search.view === 'month'
        ? direction > 0
          ? addMonths(focus, 1)
          : subMonths(focus, 1)
        : search.view === 'week'
          ? direction > 0
            ? addWeeks(focus, 1)
            : subWeeks(focus, 1)
          : addDays(focus, direction * 30)
    setSearch({ date: format(next, 'yyyy-MM-dd') })
  }

  async function connectGoogle() {
    setBusy('google-connect')
    setError(null)
    try {
      const result = await apiFetch<{ authorizationUrl: string }>(
        '/api/integrations/google/start',
        { method: 'POST' },
      )
      window.location.assign(result.authorizationUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha no Google.')
      setBusy(null)
    }
  }

  async function syncGoogle() {
    if (!connection) return
    setBusy('google-sync')
    setError(null)
    try {
      const result = await apiFetch<{
        importedEvents: number
        importedTasks: number
      }>('/api/integrations/google/sync', {
        method: 'POST',
        body: JSON.stringify({ connectionId: connection.id }),
      })
      setSuccess(
        `${result.importedEvents} eventos e ${result.importedTasks} tarefas sincronizados.`,
      )
      await load()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha na sincronização.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function reschedule(item: CalendarItem, day: Date) {
    if (item.entity !== 'event' && item.entity !== 'task') return
    setBusy(item.id)
    try {
      const old = new Date(item.startAt)
      const next = new Date(day)
      next.setHours(old.getHours(), old.getMinutes(), 0, 0)
      if (item.entity === 'event') {
        const duration =
          new Date(item.endAt as string).getTime() - old.getTime()
        await apiFetch('/api/calendar', {
          method: 'PATCH',
          body: JSON.stringify({
            entity: 'event',
            id: (item.raw as CalendarEvent).id,
            startAt: next.toISOString(),
            endAt: new Date(next.getTime() + duration).toISOString(),
          }),
        })
      } else
        await apiFetch('/api/calendar', {
          method: 'PATCH',
          body: JSON.stringify({
            entity: 'task',
            id: (item.raw as CalendarTask).id,
            dueAt: next.toISOString(),
          }),
        })
      setSuccess('Horário atualizado e sincronizado.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao reagendar.')
    } finally {
      setBusy(null)
    }
  }

  function openItem(item: CalendarItem) {
    if (item.entity === 'event')
      setEditor({
        entity: 'event',
        id: (item.raw as CalendarEvent).id,
        value: item.raw as CalendarEvent,
      })
    if (item.entity === 'task')
      setEditor({
        entity: 'task',
        id: (item.raw as CalendarTask).id,
        value: item.raw as CalendarTask,
      })
    if (item.entity === 'booking') setSelectedBooking(item.raw as Booking)
  }

  const title =
    search.view === 'month'
      ? format(focus, "MMMM 'de' yyyy", { locale: ptBR })
      : search.view === 'week'
        ? `${format(range.from, 'dd MMM', { locale: ptBR })} — ${format(addDays(range.to, -1), 'dd MMM yyyy', { locale: ptBR })}`
        : `A partir de ${format(focus, "dd 'de' MMMM", { locale: ptBR })}`

  return (
    <div className="stack-lg operational-calendar-page">
      <PageIntro
        title="Tempo organizado. Operação alinhada."
        description="Eventos, tarefas, reuniões, conteúdo e automações em uma agenda única."
        actions={
          <>
            {connection ? (
              <button
                className="button button-outline"
                onClick={() => void syncGoogle()}
                disabled={busy === 'google-sync'}
              >
                <RefreshCw
                  size={16}
                  className={busy === 'google-sync' ? 'spin' : ''}
                />
                Sincronizar
              </button>
            ) : (
              <button
                className="button button-outline"
                onClick={() => void connectGoogle()}
                disabled={
                  !google?.platformConfigured || busy === 'google-connect'
                }
              >
                <Cloud size={16} /> Conectar Google
              </button>
            )}
            <button
              className="button button-outline"
              onClick={() => setBookingOpen(true)}
            >
              <Link2 size={16} /> Links de agenda
            </button>
            <button
              className="button button-orange"
              onClick={() => setEditor({ entity: 'event', date: focus })}
              disabled={!data?.permissions.canManage}
            >
              <Plus size={16} /> Novo
            </button>
          </>
        }
      />

      {!google?.platformConfigured && (
        <div className="calendar-alert warning">
          <CircleAlert size={18} />
          <div>
            <strong>Google Workspace ainda não configurado no servidor</strong>
            <span>
              O calendário local funciona. Para Calendar, Meet e Tasks,
              configure o OAuth Google no backend.
            </span>
          </div>
          <button
            className="button button-outline"
            onClick={() => setSettingsOpen(true)}
          >
            Ver configuração
          </button>
        </div>
      )}
      {error && (
        <div className="form-error calendar-feedback" role="alert">
          <CircleAlert size={17} /> {error}
          <button onClick={() => setError(null)} aria-label="Fechar erro">
            <X size={15} />
          </button>
        </div>
      )}
      {success && (
        <div className="form-success calendar-feedback" role="status">
          <CheckCircle2 size={17} /> {success}
          <button onClick={() => setSuccess(null)} aria-label="Fechar aviso">
            <X size={15} />
          </button>
        </div>
      )}

      <section className="calendar-summary-grid" aria-label="Resumo do período">
        <article>
          <CalendarDays size={18} />
          <div>
            <strong>{data?.summary.events ?? 0}</strong>
            <span>eventos</span>
          </div>
        </article>
        <article>
          <ListTodo size={18} />
          <div>
            <strong>{data?.summary.pendingTasks ?? 0}</strong>
            <span>tarefas abertas</span>
          </div>
        </article>
        <article>
          <Video size={18} />
          <div>
            <strong>{data?.summary.bookings ?? 0}</strong>
            <span>agendamentos</span>
          </div>
        </article>
        <article>
          <RefreshCw size={18} />
          <div>
            <strong>{data?.summary.operations ?? 0}</strong>
            <span>ações do sistema</span>
          </div>
        </article>
      </section>

      <div className="calendar-workspace">
        <section className="card calendar-card operational">
          <header>
            <div className="calendar-nav">
              <button
                className="button button-outline compact"
                onClick={() =>
                  setSearch({ date: format(new Date(), 'yyyy-MM-dd') })
                }
              >
                Hoje
              </button>
              <button
                className="icon-button"
                onClick={() => move(-1)}
                aria-label="Período anterior"
              >
                <ChevronLeft size={18} />
              </button>
              <h3>{title}</h3>
              <button
                className="icon-button"
                onClick={() => move(1)}
                aria-label="Próximo período"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="calendar-toolbar">
              <label>
                <span className="sr-only">Filtrar origem</span>
                <select
                  value={search.source}
                  onChange={(event) =>
                    setSearch({
                      source: event.target.value as typeof search.source,
                    })
                  }
                >
                  <option value="all">Tudo</option>
                  <option value="calendar">Eventos</option>
                  <option value="task">Tarefas</option>
                  <option value="booking">Agendamentos</option>
                  <option value="content">Conteúdo</option>
                  <option value="automation">Automações</option>
                </select>
              </label>
              <div className="view-switch" aria-label="Visualização">
                {(['month', 'week', 'agenda'] as const).map((view) => (
                  <button
                    key={view}
                    className={search.view === view ? 'active' : ''}
                    onClick={() => setSearch({ view })}
                  >
                    {view === 'month'
                      ? 'Mês'
                      : view === 'week'
                        ? 'Semana'
                        : 'Agenda'}
                  </button>
                ))}
              </div>
              <button
                className="icon-button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Configurações do calendário"
              >
                <Settings2 size={18} />
              </button>
            </div>
          </header>
          {loading ? (
            <div className="calendar-loading">
              <LoaderCircle className="spin" size={24} /> Carregando agenda…
            </div>
          ) : search.view === 'month' ? (
            <MonthView
              focus={focus}
              items={items}
              onOpen={openItem}
              onCreate={(date) => setEditor({ entity: 'event', date })}
              onDrop={(item, date) => void reschedule(item, date)}
              busy={busy}
            />
          ) : search.view === 'week' ? (
            <WeekView
              from={range.from}
              items={items}
              onOpen={openItem}
              onCreate={(date) => setEditor({ entity: 'event', date })}
            />
          ) : (
            <AgendaView items={items} onOpen={openItem} />
          )}
        </section>

        <aside className="calendar-side">
          <section className="card calendar-google-card">
            <header>
              <div>
                <Cloud size={18} />
                <strong>Google Workspace</strong>
              </div>
              <button
                className="icon-button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Configurar Google"
              >
                <Settings2 size={16} />
              </button>
            </header>
            {connection ? (
              <>
                <StatusDot tone="green">Conectado</StatusDot>
                <strong>{connection.account_email}</strong>
                <span>
                  {connection.selected_calendar_name ?? 'Agenda principal'}
                </span>
                <small>
                  {connection.last_sync_at
                    ? `Última sincronização ${format(parseISO(connection.last_sync_at), "dd/MM 'às' HH:mm")}`
                    : 'Aguardando primeira sincronização'}
                </small>
              </>
            ) : (
              <>
                <StatusDot
                  tone={google?.platformConfigured ? 'orange' : 'gray'}
                >
                  {google?.platformConfigured
                    ? 'Pronto para conectar'
                    : 'Backend pendente'}
                </StatusDot>
                <p>
                  Use Calendar, Meet e Tasks com autorização individual e
                  segura.
                </p>
              </>
            )}
          </section>
          <section className="card calendar-activity-card">
            <header>
              <div>
                <Clock3 size={18} />
                <strong>Atividade recente</strong>
              </div>
              <span>{data?.activities.length ?? 0}</span>
            </header>
            <div className="calendar-activity-list">
              {(data?.activities ?? []).slice(0, 12).map((entry) => (
                <article key={entry.id}>
                  <i />
                  <div>
                    <strong>{entry.title}</strong>
                    <span>
                      {entry.source_type.replaceAll('_', ' ')} · {entry.action}
                    </span>
                    <time>
                      {format(parseISO(entry.happened_at), "dd/MM 'às' HH:mm")}
                    </time>
                  </div>
                </article>
              ))}
              {data?.activities.length === 0 && (
                <p className="calendar-empty">
                  As ações executadas aparecerão aqui com data e hora.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>

      {editor && (
        <ItemEditor
          state={editor}
          connection={connection}
          contacts={data?.contacts ?? []}
          onClose={() => setEditor(null)}
          onSaved={async (message) => {
            setEditor(null)
            setSuccess(message)
            await load()
          }}
          onError={setError}
        />
      )}
      {settingsOpen && (
        <GoogleSettings
          status={google}
          connection={connection}
          onClose={() => setSettingsOpen(false)}
          onConnect={() => void connectGoogle()}
          onChanged={async (message) => {
            setSuccess(message)
            setSettingsOpen(false)
            await load()
          }}
          onError={setError}
        />
      )}
      {bookingOpen && (
        <BookingPages
          connection={connection}
          onClose={() => setBookingOpen(false)}
          onChanged={async (message) => {
            setSuccess(message)
            await load()
          }}
          onError={setError}
        />
      )}
      {selectedBooking && (
        <BookingDetail
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onChanged={async (message) => {
            setSelectedBooking(null)
            setSuccess(message)
            await load()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

function CalendarItemButton({
  item,
  onOpen,
}: {
  item: CalendarItem
  onOpen: (item: CalendarItem) => void
}) {
  const label = `${format(parseISO(item.startAt), 'HH:mm')} ${item.title}`
  return (
    <button
      className={`operational-calendar-event ${itemTone(item)}`}
      draggable={item.entity === 'event' || item.entity === 'task'}
      onDragStart={(event) =>
        event.dataTransfer.setData('application/wal-calendar-item', item.id)
      }
      onClick={(event) => {
        event.stopPropagation()
        onOpen(item)
      }}
      title={label}
      aria-label={`Abrir ${label}`}
    >
      <time>{format(parseISO(item.startAt), 'HH:mm')}</time>
      <span>{item.title}</span>
      {item.status === 'sync_error' && <CircleAlert size={11} />}
    </button>
  )
}

function MonthView({
  focus,
  items,
  onOpen,
  onCreate,
  onDrop,
  busy,
}: {
  focus: Date
  items: CalendarItem[]
  onOpen: (item: CalendarItem) => void
  onCreate: (date: Date) => void
  onDrop: (item: CalendarItem, date: Date) => void
  busy: string | null
}) {
  const first = startOfWeek(startOfMonth(focus), { weekStartsOn: 1 })
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index))
  return (
    <div className="calendar-grid operational-grid">
      {weekdays.map((day) => (
        <div className="weekday" key={day}>
          {day}
        </div>
      ))}
      {days.map((day) => {
        const dayItems = items.filter((item) =>
          isSameDay(parseISO(item.startAt), day),
        )
        return (
          <div
            className={`calendar-day ${!isSameMonth(day, focus) ? 'outside' : ''} ${isSameDay(day, new Date()) ? 'today' : ''}`}
            key={day.toISOString()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const id = event.dataTransfer.getData(
                'application/wal-calendar-item',
              )
              const item = items.find((candidate) => candidate.id === id)
              if (item) onDrop(item, day)
            }}
          >
            <button
              className="calendar-day-number"
              onClick={() => onCreate(day)}
              aria-label={`Criar em ${format(day, 'dd/MM/yyyy')}`}
            >
              {format(day, 'd')}
            </button>
            <div className="calendar-day-items">
              {dayItems.slice(0, 3).map((item) => (
                <CalendarItemButton item={item} onOpen={onOpen} key={item.id} />
              ))}
              {dayItems.length > 3 && (
                <span className="calendar-more">
                  +{dayItems.length - 3} itens
                </span>
              )}
              {busy && dayItems.some((item) => item.id === busy) && (
                <LoaderCircle className="spin" size={13} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekView({
  from,
  items,
  onOpen,
  onCreate,
}: {
  from: Date
  items: CalendarItem[]
  onOpen: (item: CalendarItem) => void
  onCreate: (date: Date) => void
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index))
  return (
    <div className="calendar-week-grid">
      {days.map((day) => {
        const dayItems = items.filter((item) =>
          isSameDay(parseISO(item.startAt), day),
        )
        return (
          <section
            key={day.toISOString()}
            className={isSameDay(day, new Date()) ? 'today' : ''}
          >
            <button className="week-day-head" onClick={() => onCreate(day)}>
              <span>{format(day, 'EEE', { locale: ptBR })}</span>
              <strong>{format(day, 'dd')}</strong>
            </button>
            <div>
              {dayItems.map((item) => (
                <CalendarItemButton item={item} onOpen={onOpen} key={item.id} />
              ))}
              {dayItems.length === 0 && (
                <span className="week-empty">Livre</span>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function AgendaView({
  items,
  onOpen,
}: {
  items: CalendarItem[]
  onOpen: (item: CalendarItem) => void
}) {
  const groups = groupByDate(items, (item) =>
    format(parseISO(item.startAt), 'yyyy-MM-dd'),
  )
  if (items.length === 0)
    return <div className="calendar-loading">Nenhum item neste período.</div>
  return (
    <div className="calendar-agenda-list">
      {Array.from(groups.entries()).map(([day, dayItems]) => (
        <section key={day}>
          <header>
            <strong>
              {format(parseISO(day), "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </strong>
            <span>{dayItems.length} itens</span>
          </header>
          {dayItems.map((item) => (
            <button
              key={item.id}
              className={`agenda-row ${itemTone(item)}`}
              onClick={() => onOpen(item)}
            >
              <time>{format(parseISO(item.startAt), 'HH:mm')}</time>
              <i />
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.entity} · {item.status}
                </span>
              </div>
              {item.icon === 'meeting' && <Video size={16} />}
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

function ItemEditor({
  state,
  connection,
  contacts,
  onClose,
  onSaved,
  onError,
}: {
  state: EditorState
  connection?: GoogleConnection
  contacts: ContactOption[]
  onClose: () => void
  onSaved: (message: string) => Promise<void>
  onError: (message: string) => void
}) {
  const isEvent = state.entity === 'event'
  const calendarEvent = isEvent ? state.value : undefined
  const task = !isEvent ? state.value : undefined
  const sourceDate =
    state.date ??
    (calendarEvent
      ? parseISO(calendarEvent.start_at)
      : task?.due_at
        ? parseISO(task.due_at)
        : new Date())
  const base = new Date(sourceDate)
  base.setHours(base.getHours() < 8 ? 9 : base.getHours(), 0, 0, 0)
  const [title, setTitle] = useState(calendarEvent?.title ?? task?.title ?? '')
  const [description, setDescription] = useState(
    calendarEvent?.description ?? task?.notes ?? '',
  )
  const [startAt, setStartAt] = useState(
    calendarEvent?.all_day
      ? `${calendarEvent.start_at.slice(0, 10)}T00:00`
      : toLocalInput(calendarEvent?.start_at ?? base.toISOString()),
  )
  const [endAt, setEndAt] = useState(
    calendarEvent?.all_day
      ? `${calendarEvent.end_at.slice(0, 10)}T00:00`
      : toLocalInput(
          calendarEvent?.end_at ??
            new Date(base.getTime() + 3_600_000).toISOString(),
        ),
  )
  const [dueAt, setDueAt] = useState(
    toLocalInput(task?.due_at ?? base.toISOString()),
  )
  const [location, setLocation] = useState(calendarEvent?.location ?? '')
  const [contactId, setContactId] = useState(
    calendarEvent?.contact_id ?? task?.contact_id ?? '',
  )
  const [attendees, setAttendees] = useState(
    calendarEvent?.attendees.map((item) => item.email).join(', ') ?? '',
  )
  const [syncGoogle, setSyncGoogle] = useState(
    Boolean(
      calendarEvent?.provider === 'google' ||
      task?.provider === 'google' ||
      connection,
    ),
  )
  const [createMeet, setCreateMeet] = useState(Boolean(calendarEvent?.meet_url))
  const [allDay, setAllDay] = useState(Boolean(calendarEvent?.all_day))
  const [status, setStatus] = useState(task?.status ?? 'needs_action')
  const [priority, setPriority] = useState(task?.priority ?? 'normal')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return onError('Informe o título.')
    setSaving(true)
    try {
      const payload = isEvent
        ? {
            entity: 'event',
            id: state.id,
            title,
            description: description || null,
            startAt: fromLocalInput(startAt),
            endAt: fromLocalInput(endAt),
            allDay,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            eventType: createMeet ? 'meeting' : 'event',
            location: location || null,
            contactId: contactId || null,
            attendees: attendees
              .split(',')
              .map((email) => email.trim())
              .filter(Boolean)
              .map((email) => ({ email })),
            createMeet,
            syncGoogle,
            connectionId: syncGoogle ? connection?.id : null,
          }
        : {
            entity: 'task',
            id: state.id,
            title,
            notes: description || null,
            dueAt: dueAt ? fromLocalInput(dueAt) : null,
            status,
            priority,
            contactId: contactId || null,
            assignedTo: null,
            syncGoogle,
            connectionId: syncGoogle ? connection?.id : null,
          }
      const result = await apiFetch<{ warning?: string | null }>(
        '/api/calendar',
        {
          method: state.id ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      )
      await onSaved(
        result.warning ?? `${isEvent ? 'Evento' : 'Tarefa'} salvo com sucesso.`,
      )
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (
      !state.id ||
      !window.confirm(`Excluir ${isEvent ? 'este evento' : 'esta tarefa'}?`)
    )
      return
    setSaving(true)
    try {
      await apiFetch('/api/calendar', {
        method: 'DELETE',
        body: JSON.stringify({ entity: state.entity, id: state.id }),
      })
      await onSaved(`${isEvent ? 'Evento' : 'Tarefa'} excluído.`)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Falha ao excluir.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="crm-modal wide calendar-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-editor-title"
      >
        <header>
          <div>
            <span className="modal-icon">
              {isEvent ? <CalendarDays size={20} /> : <ListTodo size={20} />}
            </span>
            <div>
              <h2 id="calendar-editor-title">
                {state.id ? 'Editar' : 'Criar'} {isEvent ? 'evento' : 'tarefa'}
              </h2>
              <p>
                {isEvent
                  ? 'Reunião, compromisso ou Meet.'
                  : 'Atividade com prazo e responsável.'}
              </p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </header>
        <div className="form-grid two">
          <label className="form-field full">
            <span>Título *</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
              maxLength={180}
            />
          </label>
          {isEvent ? (
            <>
              <label className="form-field full compact-check">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => {
                    const enabled = event.target.checked
                    setAllDay(enabled)
                    if (enabled) {
                      const start = `${startAt.slice(0, 10)}T00:00`
                      setStartAt(start)
                      if (!state.id)
                        setEndAt(
                          toLocalInput(
                            new Date(
                              new Date(start).getTime() + 24 * 60 * 60_000,
                            ).toISOString(),
                          ),
                        )
                    }
                  }}
                />
                <span>Evento de dia inteiro</span>
              </label>
              <label className="form-field">
                <span>Início</span>
                <input
                  type={allDay ? 'date' : 'datetime-local'}
                  value={allDay ? startAt.slice(0, 10) : startAt}
                  onChange={(event) => {
                    const value = allDay
                      ? `${event.target.value}T00:00`
                      : event.target.value
                    setStartAt(value)
                    if (!state.id)
                      setEndAt(
                        allDay
                          ? toLocalInput(
                              new Date(
                                new Date(value).getTime() + 24 * 60 * 60_000,
                              ).toISOString(),
                            )
                          : addHoursInput(value),
                      )
                  }}
                />
              </label>
              <label className="form-field">
                <span>Término</span>
                <input
                  type={allDay ? 'date' : 'datetime-local'}
                  value={allDay ? endAt.slice(0, 10) : endAt}
                  onChange={(event) =>
                    setEndAt(
                      allDay
                        ? `${event.target.value}T00:00`
                        : event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                <span>Local</span>
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Online ou endereço"
                />
              </label>
              <label className="form-field">
                <span>Convidados</span>
                <input
                  value={attendees}
                  onChange={(event) => setAttendees(event.target.value)}
                  placeholder="email@exemplo.com, outro@email.com"
                />
              </label>
            </>
          ) : (
            <>
              <label className="form-field">
                <span>Prazo</span>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Prioridade</span>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </label>
              <label className="form-field">
                <span>Status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="needs_action">A fazer</option>
                  <option value="in_progress">Em andamento</option>
                  <option value="completed">Concluída</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </label>
            </>
          )}
          <label className="form-field">
            <span>Contato do CRM</span>
            <select
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
            >
              <option value="">Nenhum</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contactName(contact)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field full">
            <span>{isEvent ? 'Descrição' : 'Notas'}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </label>
        </div>
        <div className="calendar-sync-options">
          <label>
            <input
              type="checkbox"
              checked={syncGoogle}
              onChange={(event) => setSyncGoogle(event.target.checked)}
              disabled={!connection}
            />
            <span>
              <Cloud size={17} />
              <strong>Sincronizar com Google</strong>
              <small>
                {connection
                  ? connection.account_email
                  : 'Conecte uma conta primeiro'}
              </small>
            </span>
          </label>
          {isEvent && (
            <label>
              <input
                type="checkbox"
                checked={createMeet}
                onChange={(event) => {
                  setCreateMeet(event.target.checked)
                  if (event.target.checked) setSyncGoogle(true)
                }}
                disabled={!connection}
              />
              <span>
                <Video size={17} />
                <strong>Criar Google Meet</strong>
                <small>Inclui o link no convite</small>
              </span>
            </label>
          )}
        </div>
        <div className="modal-actions split">
          {state.id ? (
            <button
              className="button button-danger"
              onClick={() => void remove()}
              disabled={saving}
            >
              <Trash2 size={15} /> Excluir
            </button>
          ) : (
            <span />
          )}
          <div>
            <button className="button button-outline" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="button button-dark"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <CalendarCheck2 size={16} />
              )}{' '}
              Salvar
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function GoogleSettings({
  status,
  connection,
  onClose,
  onConnect,
  onChanged,
  onError,
}: {
  status: GoogleStatus | null
  connection?: GoogleConnection
  onClose: () => void
  onConnect: () => void
  onChanged: (message: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [calendarId, setCalendarId] = useState(
    connection?.selected_calendar_id ?? '',
  )
  const [tasklistId, setTasklistId] = useState(
    connection?.selected_tasklist_id ?? '',
  )
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!connection) return
    setSaving(true)
    try {
      await apiFetch('/api/integrations/google/status', {
        method: 'PATCH',
        body: JSON.stringify({
          connectionId: connection.id,
          calendarId,
          tasklistId: tasklistId || null,
        }),
      })
      await onChanged('Preferências Google atualizadas.')
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : 'Falha ao salvar Google.',
      )
    } finally {
      setSaving(false)
    }
  }
  async function disconnect() {
    if (
      !connection ||
      !window.confirm(
        'Desconectar o Google e remover os tokens deste workspace?',
      )
    )
      return
    setSaving(true)
    try {
      await apiFetch('/api/integrations/google/disconnect', {
        method: 'POST',
        body: JSON.stringify({ connectionId: connection.id }),
      })
      await onChanged('Google desconectado com segurança.')
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : 'Falha ao desconectar.',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="crm-modal wide calendar-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-settings-title"
      >
        <header>
          <div>
            <span className="modal-icon blue">
              <Cloud size={20} />
            </span>
            <div>
              <h2 id="google-settings-title">Google Workspace</h2>
              <p>Calendar, Meet e Tasks com OAuth por usuário.</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </header>
        {!status?.platformConfigured ? (
          <div className="calendar-setup-guide">
            <CircleAlert size={20} />
            <div>
              <strong>Configuração de backend necessária</strong>
              <ol>
                <li>Crie um OAuth Client do tipo Web no Google Cloud.</li>
                <li>Ative Google Calendar API e Google Tasks API.</li>
                <li>
                  Cadastre a URI <code>{status?.redirectUri}</code>.
                </li>
                <li>
                  Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET somente no
                  servidor.
                </li>
              </ol>
            </div>
          </div>
        ) : !connection ? (
          <div className="calendar-connect-empty">
            <Cloud size={32} />
            <h3>Conecte sua conta Google</h3>
            <p>
              O Wal Chat pedirá apenas os escopos de eventos, lista de
              calendários e tarefas.
            </p>
            <button className="button button-dark" onClick={onConnect}>
              Autorizar Google
            </button>
          </div>
        ) : (
          <>
            <div className="google-account-banner">
              <CheckCircle2 size={20} />
              <div>
                <strong>
                  {connection.display_name ?? connection.account_email}
                </strong>
                <span>{connection.account_email}</span>
              </div>
              <StatusDot tone="green">OAuth ativo</StatusDot>
            </div>
            <div className="form-grid two">
              <label className="form-field">
                <span>Calendário de eventos</span>
                <select
                  value={calendarId}
                  onChange={(event) => setCalendarId(event.target.value)}
                >
                  {connection.available_calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.summary}
                      {calendar.primary ? ' (principal)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Lista do Google Tasks</span>
                <select
                  value={tasklistId}
                  onChange={(event) => setTasklistId(event.target.value)}
                >
                  <option value="">Sem sincronizar tarefas</option>
                  {connection.available_tasklists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="calendar-scope-list">
              <strong>Permissões autorizadas</strong>
              {status.requiredScopes.map((scope) => (
                <span key={scope}>
                  <CheckCircle2 size={13} />{' '}
                  {scope.replace('https://www.googleapis.com/auth/', '')}
                </span>
              ))}
            </div>
            <div className="modal-actions split">
              <button
                className="button button-danger"
                onClick={() => void disconnect()}
                disabled={saving}
              >
                Desconectar
              </button>
              <div>
                <button className="button button-outline" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  className="button button-dark"
                  onClick={() => void save()}
                  disabled={saving || !calendarId}
                >
                  Salvar
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function BookingPages({
  connection,
  onClose,
  onChanged,
  onError,
}: {
  connection?: GoogleConnection
  onClose: () => void
  onChanged: (message: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [pages, setPages] = useState<BookingPage[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [title, setTitle] = useState('Conversa com o Wal Chat')
  const [slug, setSlug] = useState('conversa-wal-chat')
  const [description, setDescription] = useState(
    'Escolha o melhor horário para nossa conversa.',
  )
  const [duration, setDuration] = useState(30)
  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('18:00')
  const [activeDays, setActiveDays] = useState([1, 2, 3, 4, 5])
  const [bufferAfter, setBufferAfter] = useState(15)
  const [noticeHours, setNoticeHours] = useState(2)
  const [advanceDays, setAdvanceDays] = useState(60)
  const [requirePhone, setRequirePhone] = useState(false)
  const [createMeet, setCreateMeet] = useState(Boolean(connection))
  const [saving, setSaving] = useState(false)
  const loadPages = useCallback(async () => {
    try {
      setPages(
        (
          await apiFetch<{ pages: BookingPage[] }>(
            '/api/calendar/booking-pages',
          )
        ).pages,
      )
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : 'Falha ao carregar links.',
      )
    }
  }, [onError])
  useEffect(() => void loadPages(), [loadPages])
  function resetForm() {
    setEditId(null)
    setTitle('Conversa com o Wal Chat')
    setSlug('conversa-wal-chat')
    setDescription('Escolha o melhor horário para nossa conversa.')
    setDuration(30)
    setStartTime('09:00')
    setEndTime('18:00')
    setActiveDays([1, 2, 3, 4, 5])
    setBufferAfter(15)
    setNoticeHours(2)
    setAdvanceDays(60)
    setRequirePhone(false)
    setCreateMeet(Boolean(connection))
  }
  function editPage(page: BookingPage) {
    const configuredDays = Object.entries(page.availability ?? {})
      .filter(([, windows]) => windows.length > 0)
      .map(([day]) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    const firstWindow = configuredDays
      .map((day) => page.availability?.[String(day)]?.[0])
      .find(Boolean)
    setEditId(page.id)
    setTitle(page.title)
    setSlug(page.slug)
    setDescription(page.description ?? '')
    setDuration(page.durationMinutes ?? page.duration_minutes ?? 30)
    setTimezone(page.timezone)
    setStartTime(firstWindow?.start ?? '09:00')
    setEndTime(firstWindow?.end ?? '18:00')
    setActiveDays(configuredDays.length ? configuredDays : [1, 2, 3, 4, 5])
    setBufferAfter(page.bufferAfterMinutes ?? 15)
    setNoticeHours(Math.round((page.minimumNoticeMinutes ?? 120) / 60))
    setAdvanceDays(page.maxAdvanceDays ?? 60)
    setRequirePhone(page.requirePhone ?? false)
    setCreateMeet(page.createMeet ?? page.create_meet ?? Boolean(connection))
  }
  async function create() {
    setSaving(true)
    try {
      const availability = Object.fromEntries(
        activeDays.map((day) => [
          String(day),
          [{ start: startTime, end: endTime }],
        ]),
      )
      await apiFetch('/api/calendar/booking-pages', {
        method: editId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(editId ? { id: editId } : {}),
          title,
          slug,
          description,
          durationMinutes: duration,
          timezone,
          availability,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: bufferAfter,
          minimumNoticeMinutes: noticeHours * 60,
          maxAdvanceDays: advanceDays,
          createMeet: createMeet && Boolean(connection),
          requirePhone,
          confirmationMessage: 'Fechado! Seu horário está confirmado.',
          isActive: true,
          connectionId: connection?.id ?? null,
          calendarId: connection?.selected_calendar_id ?? 'primary',
        }),
      })
      await loadPages()
      await onChanged(
        editId
          ? 'Link de agenda atualizado.'
          : 'Novo link público de agenda criado.',
      )
      resetForm()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Falha ao criar link.')
    } finally {
      setSaving(false)
    }
  }
  async function deactivate(id: string) {
    if (
      !window.confirm(
        'Desativar este link? Agendamentos existentes serão preservados.',
      )
    )
      return
    try {
      await apiFetch('/api/calendar/booking-pages', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      })
      await loadPages()
      await onChanged('Link de agenda desativado.')
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Falha ao desativar.')
    }
  }
  async function copy(url?: string) {
    if (!url) return
    await navigator.clipboard.writeText(url)
    await onChanged(
      'Link copiado. Use em gatilhos, sequências ou no agente de IA.',
    )
  }
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="crm-modal wide booking-pages-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-pages-title"
      >
        <header>
          <div>
            <span className="modal-icon">
              <Link2 size={20} />
            </span>
            <div>
              <h2 id="booking-pages-title">Links de agendamento</h2>
              <p>Disponibilidade real para leads, gatilhos e agentes de IA.</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </header>
        <div className="booking-pages-layout">
          <div className="booking-page-list">
            {pages.map((page) => (
              <article key={page.id}>
                <div>
                  <StatusDot
                    tone={(page.isActive ?? page.is_active) ? 'green' : 'gray'}
                  >
                    {(page.isActive ?? page.is_active) ? 'Ativo' : 'Inativo'}
                  </StatusDot>
                  <strong>{page.title}</strong>
                  <span>
                    {page.durationMinutes ?? page.duration_minutes} min ·{' '}
                    {page.timezone}
                  </span>
                </div>
                <div>
                  <button
                    className="icon-button"
                    onClick={() => editPage(page)}
                    aria-label="Editar link"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => void copy(page.publicUrl)}
                    aria-label="Copiar link"
                  >
                    <Copy size={16} />
                  </button>
                  {page.publicUrl && (
                    <a
                      className="icon-button"
                      href={page.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Abrir link"
                    >
                      <ExternalLink size={16} />
                    </a>
                  )}
                  <button
                    className="icon-button danger"
                    onClick={() => void deactivate(page.id)}
                    aria-label="Desativar"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
            {pages.length === 0 && (
              <p className="calendar-empty">Nenhum link criado ainda.</p>
            )}
          </div>
          <form
            className="booking-page-form"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <div className="booking-form-title">
              <h3>
                {editId ? 'Editar tipo de reunião' : 'Novo tipo de reunião'}
              </h3>
              {editId && (
                <button
                  type="button"
                  className="text-button"
                  onClick={resetForm}
                >
                  Criar novo
                </button>
              )}
            </div>
            <label className="form-field">
              <span>Nome</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Descrição</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
              />
            </label>
            <label className="form-field">
              <span>Endereço público</span>
              <div className="slug-input">
                <span>/agendar/</span>
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                />
              </div>
            </label>
            <div className="form-grid two">
              <label className="form-field">
                <span>Duração</span>
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                >
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>60 min</option>
                </select>
              </label>
              <label className="form-field">
                <span>Fuso</span>
                <input
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </label>
            </div>
            <div className="form-grid two">
              <label className="form-field">
                <span>Início dos horários</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Fim dos horários</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Intervalo após reunião</span>
                <select
                  value={bufferAfter}
                  onChange={(event) =>
                    setBufferAfter(Number(event.target.value))
                  }
                >
                  <option value={0}>Sem intervalo</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                </select>
              </label>
              <label className="form-field">
                <span>Antecedência mínima</span>
                <select
                  value={noticeHours}
                  onChange={(event) =>
                    setNoticeHours(Number(event.target.value))
                  }
                >
                  <option value={0}>Sem limite</option>
                  <option value={2}>2 horas</option>
                  <option value={12}>12 horas</option>
                  <option value={24}>24 horas</option>
                </select>
              </label>
              <label className="form-field">
                <span>Janela futura</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={advanceDays}
                  onChange={(event) =>
                    setAdvanceDays(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <fieldset className="booking-weekdays">
              <legend>Dias disponíveis</legend>
              {[
                { label: 'D', day: 0 },
                { label: 'S', day: 1 },
                { label: 'T', day: 2 },
                { label: 'Q', day: 3 },
                { label: 'Q', day: 4 },
                { label: 'S', day: 5 },
                { label: 'S', day: 6 },
              ].map(({ label, day }) => (
                <label key={day} title={weekdays[(day + 6) % 7]}>
                  <input
                    type="checkbox"
                    checked={activeDays.includes(day)}
                    onChange={() =>
                      setActiveDays((current) =>
                        current.includes(day)
                          ? current.filter((item) => item !== day)
                          : [...current, day].sort(),
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <div className="booking-option-checks">
              <label>
                <input
                  type="checkbox"
                  checked={requirePhone}
                  onChange={(event) => setRequirePhone(event.target.checked)}
                />
                Exigir telefone do lead
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createMeet}
                  onChange={(event) => setCreateMeet(event.target.checked)}
                  disabled={!connection}
                />
                Criar Google Meet automaticamente
              </label>
            </div>
            <div className="availability-preview">
              <Clock3 size={17} />
              <span>
                <strong>
                  {activeDays.length} dia(s) por semana, {startTime}–{endTime}
                </strong>
                <small>
                  {bufferAfter} min de intervalo · {noticeHours}h de
                  antecedência
                </small>
              </span>
            </div>
            <button
              className="button button-dark"
              type="submit"
              disabled={saving || activeDays.length === 0}
            >
              {saving ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}{' '}
              {editId ? 'Salvar alterações' : 'Criar link'}
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}

function BookingDetail({
  booking,
  onClose,
  onChanged,
  onError,
}: {
  booking: Booking
  onClose: () => void
  onChanged: (message: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [saving, setSaving] = useState(false)
  async function changeStatus(
    status: 'confirmed' | 'cancelled' | 'completed' | 'no_show',
  ) {
    if (
      status === 'cancelled' &&
      !window.confirm('Cancelar este agendamento e o convite Google?')
    )
      return
    setSaving(true)
    try {
      await apiFetch('/api/calendar/bookings', {
        method: 'PATCH',
        body: JSON.stringify({ id: booking.id, status }),
      })
      await onChanged(
        status === 'cancelled'
          ? 'Agendamento cancelado.'
          : status === 'completed'
            ? 'Reunião marcada como concluída.'
            : status === 'no_show'
              ? 'Ausência registrada.'
              : 'Agendamento confirmado.',
      )
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : 'Falha ao atualizar agendamento.',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="crm-modal calendar-editor booking-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-detail-title"
      >
        <header>
          <div>
            <span className="modal-icon">
              <Video size={20} />
            </span>
            <div>
              <h2 id="booking-detail-title">
                {booking.booking_pages?.title ?? 'Agendamento'}
              </h2>
              <p>Lead e horário sincronizados com a operação.</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </header>
        <div className="booking-detail-content">
          <div className="selected-public-slot">
            <CalendarCheck2 size={20} />
            <div>
              <strong>
                {format(parseISO(booking.start_at), "EEEE, dd 'de' MMMM", {
                  locale: ptBR,
                })}
              </strong>
              <span>
                {format(parseISO(booking.start_at), 'HH:mm')}–
                {format(parseISO(booking.end_at), 'HH:mm')} · {booking.timezone}
              </span>
            </div>
          </div>
          <dl>
            <div>
              <dt>Contato</dt>
              <dd>{booking.guest_name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{booking.guest_email}</dd>
            </div>
            <div>
              <dt>Telefone</dt>
              <dd>{booking.guest_phone ?? 'Não informado'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{booking.status}</dd>
            </div>
          </dl>
          {booking.meet_url && (
            <a
              className="button button-outline"
              href={booking.meet_url}
              target="_blank"
              rel="noreferrer"
            >
              <Video size={16} /> Abrir Google Meet
            </a>
          )}
        </div>
        <div className="modal-actions split">
          <button
            className="button button-danger"
            disabled={saving || booking.status === 'cancelled'}
            onClick={() => void changeStatus('cancelled')}
          >
            Cancelar
          </button>
          <div>
            <button
              className="button button-outline"
              disabled={saving}
              onClick={() => void changeStatus('no_show')}
            >
              Não compareceu
            </button>
            <button
              className="button button-dark"
              disabled={saving}
              onClick={() => void changeStatus('completed')}
            >
              Concluir
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
