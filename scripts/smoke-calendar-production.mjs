/**
 * Smoke destrutivo e autocontido do calendário. Cria um usuário/workspace
 * temporários e os elimina no finally; nunca imprime senha, JWT ou secrets.
 */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

if (process.env.ALLOW_CALENDAR_SMOKE !== 'true') {
  console.error('Defina ALLOW_CALENDAR_SMOKE=true para executar o smoke.')
  process.exit(2)
}

const supabaseUrl = process.env.SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY
if (!supabaseUrl || !serviceRole || !publishable)
  throw new Error('Supabase não configurado para o smoke.')

const admin = createClient(supabaseUrl, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const browserClient = createClient(supabaseUrl, publishable, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const runId = randomUUID()
const email = `calendar-qa-${runId}@example.invalid`
const password = `Qa!1-${randomUUID()}`
const appUrl = 'http://127.0.0.1:3000'
const trustedOrigin = process.env.APP_ORIGIN ?? appUrl
let userId

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, options = {}, accessToken) {
  const response = await fetch(`${appUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.method && options.method !== 'GET'
        ? { Origin: trustedOrigin }
        : {}),
      ...options.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

function nextWeekday() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 3)
  date.setUTCHours(12, 0, 0, 0)
  return date
}

try {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'QA Calendário' },
  })
  if (created.error) throw created.error
  userId = created.data.user.id
  const login = await browserClient.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  const accessToken = login.data.session.access_token

  const target = nextWeekday()
  const date = target.toISOString().slice(0, 10)
  const weekday = String(target.getUTCDay())
  const rangeFrom = new Date(`${date}T00:00:00.000Z`).toISOString()
  const rangeTo = new Date(
    new Date(rangeFrom).getTime() + 24 * 60 * 60_000,
  ).toISOString()

  const event = await request(
    '/api/calendar',
    {
      method: 'POST',
      body: JSON.stringify({
        entity: 'event',
        title: 'Smoke: evento local',
        description: 'Valida persistência do calendário.',
        startAt: new Date(`${date}T15:00:00.000Z`).toISOString(),
        endAt: new Date(`${date}T16:00:00.000Z`).toISOString(),
        allDay: false,
        timezone: 'America/Sao_Paulo',
        eventType: 'event',
        attendees: [],
        createMeet: false,
        syncGoogle: false,
        connectionId: null,
      }),
    },
    accessToken,
  )
  assert(event.response.status === 201, 'calendar_event_create_failed')

  const task = await request(
    '/api/calendar',
    {
      method: 'POST',
      body: JSON.stringify({
        entity: 'task',
        title: 'Smoke: tarefa local',
        dueAt: new Date(`${date}T17:00:00.000Z`).toISOString(),
        status: 'needs_action',
        priority: 'high',
        syncGoogle: false,
        connectionId: null,
      }),
    },
    accessToken,
  )
  assert(task.response.status === 201, 'calendar_task_create_failed')

  const slug = `qa-calendar-${runId}`
  const page = await request(
    '/api/calendar/booking-pages',
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'Smoke: agenda pública',
        slug,
        description: 'Agenda temporária de QA.',
        durationMinutes: 30,
        timezone: 'America/Sao_Paulo',
        availability: { [weekday]: [{ start: '09:00', end: '11:00' }] },
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 15,
        minimumNoticeMinutes: 0,
        maxAdvanceDays: 365,
        createMeet: false,
        requirePhone: false,
        confirmationMessage: 'Confirmado no smoke.',
        isActive: true,
        connectionId: null,
        calendarId: 'primary',
      }),
    },
    accessToken,
  )
  assert(page.response.status === 201, 'booking_page_create_failed')

  const slots = await request(
    `/api/public/bookings/${slug}?from=${date}&to=${date}`,
  )
  assert(slots.response.ok, 'booking_slots_failed')
  assert(slots.payload.slots?.length > 1, 'booking_slots_empty')
  const selected = slots.payload.slots[0]
  const idempotencyKey = randomUUID()
  const bookingBody = JSON.stringify({
    startAt: selected.startAt,
    name: 'Lead QA',
    email: `lead-${runId}@example.invalid`,
    idempotencyKey,
    source: 'public_page',
  })
  const booking = await request(`/api/public/bookings/${slug}`, {
    method: 'POST',
    body: bookingBody,
  })
  assert(booking.response.status === 201, 'public_booking_failed')
  const repeated = await request(`/api/public/bookings/${slug}`, {
    method: 'POST',
    body: bookingBody,
  })
  assert(repeated.response.ok, 'booking_idempotency_failed')
  assert(
    repeated.payload.booking?.id === booking.payload.booking?.id,
    'booking_idempotency_changed_id',
  )

  const refreshedSlots = await request(
    `/api/public/bookings/${slug}?from=${date}&to=${date}`,
  )
  assert(refreshedSlots.response.ok, 'booking_refresh_failed')
  assert(
    !refreshedSlots.payload.slots.some(
      (slot) =>
        new Date(slot.startAt).getTime() <
        new Date(selected.endAt).getTime() + 15 * 60_000,
    ),
    'booking_buffer_not_enforced',
  )

  const calendar = await request(
    `/api/calendar?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
    {},
    accessToken,
  )
  assert(calendar.response.ok, 'calendar_read_failed')
  assert(calendar.payload.events?.length >= 2, 'calendar_events_missing')
  assert(calendar.payload.tasks?.length >= 1, 'calendar_tasks_missing')
  assert(calendar.payload.bookings?.length === 1, 'calendar_booking_missing')

  const googleStatus = await request(
    '/api/integrations/google/status',
    {},
    accessToken,
  )
  assert(googleStatus.response.ok, 'google_status_failed')

  console.log(
    JSON.stringify({
      ok: true,
      checks: {
        event: true,
        task: true,
        bookingPage: true,
        booking: true,
        idempotency: true,
        buffer: true,
        unifiedRead: true,
        googleStatus: true,
      },
    }),
  )
} finally {
  if (userId) {
    const workspaces = await admin
      .from('workspaces')
      .select('id')
      .eq('owner_id', userId)
    for (const workspace of workspaces.data ?? []) {
      await admin.from('bookings').delete().eq('workspace_id', workspace.id)
      await admin
        .from('booking_pages')
        .delete()
        .eq('workspace_id', workspace.id)
    }
    const cleanup = await admin.auth.admin.deleteUser(userId)
    if (cleanup.error)
      console.error(
        JSON.stringify({ ok: false, cleanup: 'user_delete_failed' }),
      )
  }
}
