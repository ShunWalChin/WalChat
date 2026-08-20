/** Cliente server-only das APIs Google Calendar, Meet e Tasks. */
import '@tanstack/react-start/server-only'
import { createHash, randomBytes } from 'node:crypto'
import { getServerEnv } from './env.server'
import { getSupabaseAdmin } from './supabase-admin.server'
import {
  getIntegrationCredential,
  saveIntegrationCredential,
} from './integration-credentials.server'

export const GOOGLE_WORKSPACE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/tasks',
] as const

const GOOGLE_TIMEOUT_MS = 20_000

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`A API Google recusou a operação (HTTP ${status}).`)
    this.name = 'GoogleApiError'
  }
}

function requireAdmin() {
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('Supabase administrativo indisponível.')
  return admin
}

function oauthRedirectUri() {
  const env = getServerEnv()
  return (
    env.GOOGLE_OAUTH_REDIRECT_URI ??
    `${env.APP_ORIGIN}/api/integrations/google/callback`
  )
}

export function googleWorkspaceConfigured() {
  const env = getServerEnv()
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

async function fetchGoogle(input: string | URL, init?: RequestInit) {
  try {
    return await fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new GoogleApiError(timeout ? 504 : 503, 'network_error')
  }
}

async function parseGoogle<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { status?: string; message?: string } | string
  }
  if (!response.ok) {
    const code =
      typeof payload.error === 'object'
        ? (payload.error.status ?? 'google_api_error')
        : (payload.error ?? 'google_api_error')
    throw new GoogleApiError(response.status, String(code))
  }
  return payload as T
}

/** Cria state de uso único e par PKCE; o verifier fica só em cookie HttpOnly. */
export async function createGoogleOAuthState(input: {
  workspaceId: string
  userId: string
}) {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(64).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const stateHash = createHash('sha256').update(state).digest('hex')
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  const admin = requireAdmin()
  await admin
    .from('integration_oauth_states')
    .delete()
    .eq('provider', 'google')
    .eq('user_id', input.userId)
    .lt('expires_at', new Date().toISOString())
  const { error } = await admin.from('integration_oauth_states').insert({
    state_hash: stateHash,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    provider: 'google',
    redirect_after: '/calendario',
    expires_at: expiresAt,
  })
  if (error) throw error
  return { state, verifier, challenge }
}

export async function consumeGoogleOAuthState(state: string) {
  const admin = requireAdmin()
  const stateHash = createHash('sha256').update(state).digest('hex')
  const { data, error } = await admin
    .from('integration_oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('state_hash', stateHash)
    .eq('provider', 'google')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('workspace_id,user_id,redirect_after')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('State OAuth inválido, expirado ou já utilizado.')
  const membership = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', data.workspace_id)
    .eq('user_id', data.user_id)
    .in('role', ['owner', 'admin'])
    .maybeSingle()
  if (membership.error) throw membership.error
  if (!membership.data)
    throw new Error('Usuário não pode mais conectar o Google neste workspace.')
  return data
}

export function buildGoogleAuthorizationUrl(input: {
  state: string
  challenge: string
}) {
  const env = getServerEnv()
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new Error('GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET são obrigatórios.')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', oauthRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_WORKSPACE_SCOPES.join(' '))
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  verifier: string,
) {
  const env = getServerEnv()
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new Error('Credenciais Google ausentes.')
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: oauthRedirectUri(),
  })
  const response = await fetchGoogle('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return parseGoogle<{
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
    token_type: string
    id_token?: string
  }>(response)
}

export async function getGoogleProfile(accessToken: string) {
  const response = await fetchGoogle(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  return parseGoogle<{
    sub: string
    email: string
    email_verified?: boolean
    name?: string
    picture?: string
  }>(response)
}

/** Revoga a concessão no Google; a remoção local continua obrigatória. */
export async function revokeGoogleToken(token: string) {
  const response = await fetchGoogle(
    `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  )
  if (!response.ok && response.status !== 400)
    throw new GoogleApiError(response.status, 'token_revocation_failed')
}

async function refreshGoogleAccessToken(input: {
  workspaceId: string
  connectionId: string
}) {
  const refresh = await getIntegrationCredential({
    workspaceId: input.workspaceId,
    provider: 'google',
    credentialType: 'refresh_token',
    scopeKey: input.connectionId,
  })
  if (!refresh?.value)
    throw new GoogleApiError(401, 'google_reconnect_required')
  const env = getServerEnv()
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new GoogleApiError(503, 'google_platform_not_configured')
  const response = await fetchGoogle('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh.value,
      grant_type: 'refresh_token',
    }),
  })
  const token = await parseGoogle<{
    access_token: string
    expires_in: number
    scope?: string
    token_type?: string
  }>(response)
  const expiresAt = new Date(
    Date.now() + token.expires_in * 1_000,
  ).toISOString()
  await saveIntegrationCredential({
    workspaceId: input.workspaceId,
    provider: 'google',
    credentialType: 'access_token',
    scopeKey: input.connectionId,
    value: token.access_token,
    expiresAt,
    metadata: { tokenType: token.token_type ?? 'Bearer' },
  })
  return token.access_token
}

export async function getGoogleAccessToken(input: {
  workspaceId: string
  connectionId: string
}) {
  const admin = requireAdmin()
  const connection = await admin
    .from('calendar_connections')
    .select('id,status')
    .eq('id', input.connectionId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (connection.error) throw connection.error
  if (!connection.data || connection.data.status !== 'connected')
    throw new GoogleApiError(401, 'google_connection_unavailable')
  const stored = await getIntegrationCredential({
    workspaceId: input.workspaceId,
    provider: 'google',
    credentialType: 'access_token',
    scopeKey: input.connectionId,
  })
  if (
    stored?.value &&
    (!stored.expiresAt ||
      new Date(stored.expiresAt).getTime() > Date.now() + 60_000)
  )
    return stored.value
  try {
    return await refreshGoogleAccessToken(input)
  } catch (error) {
    await admin
      .from('calendar_connections')
      .update({
        status:
          error instanceof GoogleApiError && error.status === 401
            ? 'expired'
            : 'error',
        connection_error:
          error instanceof GoogleApiError ? error.code : 'token_refresh_failed',
      })
      .eq('id', input.connectionId)
      .eq('workspace_id', input.workspaceId)
    throw error
  }
}

async function googleApi<T>(input: {
  workspaceId: string
  connectionId: string
  url: string | URL
  init?: RequestInit
}) {
  const token = await getGoogleAccessToken(input)
  const headers = new Headers(input.init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (input.init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetchGoogle(input.url, { ...input.init, headers })
  return parseGoogle<T>(response)
}

export type GoogleCalendarOption = {
  id: string
  summary: string
  primary: boolean
  accessRole: string
  timeZone?: string
}

export async function listGoogleCalendars(input: {
  workspaceId: string
  connectionId: string
}) {
  const result = await googleApi<{
    items?: Array<{
      id: string
      summary: string
      primary?: boolean
      accessRole?: string
      timeZone?: string
      deleted?: boolean
    }>
  }>({
    ...input,
    url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&showDeleted=false',
  })
  return (result.items ?? [])
    .filter((item) => !item.deleted && item.id)
    .map((item) => ({
      id: item.id,
      summary: item.summary,
      primary: item.primary === true,
      accessRole: item.accessRole ?? 'reader',
      timeZone: item.timeZone,
    }))
}

export type GoogleTaskListOption = { id: string; title: string }

export async function listGoogleTaskLists(input: {
  workspaceId: string
  connectionId: string
}) {
  const result = await googleApi<{
    items?: Array<{ id: string; title: string }>
  }>({
    ...input,
    url: 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100',
  })
  return (result.items ?? []).map((item) => ({
    id: item.id,
    title: item.title,
  }))
}

type CalendarEventInput = {
  localId: string
  calendarId: string
  title: string
  description?: string | null
  location?: string | null
  startAt: string
  endAt: string
  allDay: boolean
  timezone: string
  createMeet: boolean
  attendees: Array<{ email: string; displayName?: string }>
}

type GoogleEvent = {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  hangoutLink?: string
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
  attendees?: Array<{
    email: string
    displayName?: string
    responseStatus?: string
  }>
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>
  }
  extendedProperties?: { private?: Record<string, string> }
  updated?: string
}

function eventBody(input: CalendarEventInput) {
  const startDate = input.startAt.slice(0, 10)
  const endDate = input.endAt.slice(0, 10)
  return {
    summary: input.title,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    start: input.allDay
      ? { date: startDate }
      : { dateTime: input.startAt, timeZone: input.timezone },
    end: input.allDay
      ? { date: endDate }
      : { dateTime: input.endAt, timeZone: input.timezone },
    attendees: input.attendees,
    extendedProperties: { private: { walChatEventId: input.localId } },
    ...(input.createMeet
      ? {
          conferenceData: {
            createRequest: {
              requestId: `wal-${input.localId}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }
      : {}),
  }
}

function calendarEventUrl(calendarId: string, eventId?: string) {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base
}

/** Busca pelo identificador privado antes de inserir para tolerar timeout/retry. */
async function findGoogleEvent(input: {
  workspaceId: string
  connectionId: string
  calendarId: string
  localId: string
}) {
  const url = new URL(calendarEventUrl(input.calendarId))
  url.searchParams.set(
    'privateExtendedProperty',
    `walChatEventId=${input.localId}`,
  )
  url.searchParams.set('maxResults', '1')
  url.searchParams.set('showDeleted', 'true')
  const result = await googleApi<{ items?: GoogleEvent[] }>({ ...input, url })
  return result.items?.[0] ?? null
}

export async function upsertGoogleEvent(input: {
  workspaceId: string
  connectionId: string
  providerEventId?: string | null
  event: CalendarEventInput
}) {
  const existing =
    input.providerEventId ||
    (
      await findGoogleEvent({
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        calendarId: input.event.calendarId,
        localId: input.event.localId,
      })
    )?.id
  const url = new URL(
    calendarEventUrl(input.event.calendarId, existing ?? undefined),
  )
  url.searchParams.set('conferenceDataVersion', '1')
  url.searchParams.set(
    'sendUpdates',
    input.event.attendees.length > 0 ? 'all' : 'none',
  )
  return googleApi<GoogleEvent>({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    url,
    init: {
      method: existing ? 'PATCH' : 'POST',
      body: JSON.stringify(eventBody(input.event)),
    },
  })
}

export async function deleteGoogleEvent(input: {
  workspaceId: string
  connectionId: string
  calendarId: string
  providerEventId: string
}) {
  const token = await getGoogleAccessToken(input)
  const url = new URL(calendarEventUrl(input.calendarId, input.providerEventId))
  url.searchParams.set('sendUpdates', 'all')
  const response = await fetchGoogle(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status !== 204 && response.status !== 410)
    await parseGoogle(response)
}

export async function upsertGoogleTask(input: {
  workspaceId: string
  connectionId: string
  tasklistId: string
  providerTaskId?: string | null
  title: string
  notes?: string | null
  dueAt?: string | null
  completed: boolean
}) {
  const base = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(input.tasklistId)}/tasks`
  const url = input.providerTaskId
    ? `${base}/${encodeURIComponent(input.providerTaskId)}`
    : base
  return googleApi<{
    id: string
    title: string
    notes?: string
    due?: string
    status?: string
    completed?: string
  }>({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    url,
    init: {
      method: input.providerTaskId ? 'PATCH' : 'POST',
      body: JSON.stringify({
        title: input.title,
        notes: input.notes ?? undefined,
        due: input.dueAt ?? undefined,
        status: input.completed ? 'completed' : 'needsAction',
        completed: input.completed ? new Date().toISOString() : undefined,
      }),
    },
  })
}

export async function deleteGoogleTask(input: {
  workspaceId: string
  connectionId: string
  tasklistId: string
  providerTaskId: string
}) {
  const token = await getGoogleAccessToken(input)
  const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(input.tasklistId)}/tasks/${encodeURIComponent(input.providerTaskId)}`
  const response = await fetchGoogle(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status !== 204 && response.status !== 404)
    await parseGoogle(response)
}

export async function queryGoogleFreeBusy(input: {
  workspaceId: string
  connectionId: string
  calendarId: string
  timeMin: string
  timeMax: string
  timezone: string
}) {
  const result = await googleApi<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>
  }>({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    url: 'https://www.googleapis.com/calendar/v3/freeBusy',
    init: {
      method: 'POST',
      body: JSON.stringify({
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        timeZone: input.timezone,
        items: [{ id: input.calendarId }],
      }),
    },
  })
  return result.calendars?.[input.calendarId]?.busy ?? []
}

function googleDate(value?: { date?: string; dateTime?: string }) {
  if (value?.dateTime) return value.dateTime
  if (value?.date) return `${value.date}T00:00:00.000Z`
  return null
}

function meetUrl(event: GoogleEvent) {
  return (
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === 'video',
    )?.uri ??
    null
  )
}

/** Importa alterações Google e persiste nextSyncToken; 410 força full sync. */
export async function syncGoogleConnection(input: {
  workspaceId: string
  connectionId: string
  forceFull?: boolean
}) {
  const admin = requireAdmin()
  const connectionResult = await admin
    .from('calendar_connections')
    .select('id,selected_calendar_id,selected_tasklist_id,sync_token')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.connectionId)
    .eq('status', 'connected')
    .maybeSingle()
  if (connectionResult.error) throw connectionResult.error
  const connection = connectionResult.data
  if (!connection) throw new GoogleApiError(404, 'google_connection_not_found')
  const calendarId = connection.selected_calendar_id || 'primary'
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  let importedEvents = 0
  try {
    do {
      const url = new URL(calendarEventUrl(calendarId))
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('showDeleted', 'true')
      url.searchParams.set('maxResults', '500')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      if (connection.sync_token && !input.forceFull)
        url.searchParams.set('syncToken', connection.sync_token)
      else {
        url.searchParams.set(
          'timeMin',
          new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString(),
        )
        url.searchParams.set(
          'timeMax',
          new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString(),
        )
      }
      const page = await googleApi<{
        items?: GoogleEvent[]
        nextPageToken?: string
        nextSyncToken?: string
      }>({ ...input, url })
      for (const event of page.items ?? []) {
        if (event.id && event.status === 'cancelled') {
          const cancelled = await admin
            .from('calendar_events')
            .update({
              status: 'cancelled',
              last_synced_at: new Date().toISOString(),
              sync_error: null,
            })
            .eq('workspace_id', input.workspaceId)
            .eq('calendar_connection_id', input.connectionId)
            .eq('provider_event_id', event.id)
          if (cancelled.error) throw cancelled.error
          importedEvents++
          continue
        }
        const startAt = googleDate(event.start)
        const endAt = googleDate(event.end)
        if (!event.id || !startAt || !endAt) continue
        const localId = event.extendedProperties?.private?.walChatEventId
        const payload = {
          workspace_id: input.workspaceId,
          calendar_connection_id: input.connectionId,
          provider: 'google',
          provider_event_id: event.id,
          calendar_id: calendarId,
          event_type: event.hangoutLink ? 'meeting' : 'event',
          title: event.summary?.slice(0, 180) || 'Evento Google',
          description: event.description?.slice(0, 8000) ?? null,
          start_at: startAt,
          end_at: endAt,
          all_day: Boolean(event.start?.date),
          timezone: event.start?.timeZone ?? 'America/Sao_Paulo',
          status: event.status === 'cancelled' ? 'cancelled' : 'confirmed',
          location: event.location?.slice(0, 500) ?? null,
          meet_url: meetUrl(event),
          html_link: event.htmlLink ?? null,
          attendees: event.attendees ?? [],
          last_synced_at: new Date().toISOString(),
          sync_error: null,
          metadata: { googleUpdated: event.updated ?? null },
        }
        // O identificador privado acelera a reconciliação, mas nunca é
        // tratado como confiável: ele pode apontar para um registro removido.
        // Nesse caso reimportamos pelo identificador imutável do Google.
        let updatedLocalEvent = false
        if (localId) {
          const updated = await admin
            .from('calendar_events')
            .update(payload)
            .eq('id', localId)
            .eq('workspace_id', input.workspaceId)
            .select('id')
            .maybeSingle()
          if (updated.error) throw updated.error
          updatedLocalEvent = Boolean(updated.data)
        }
        if (!updatedLocalEvent) {
          const imported = await admin.from('calendar_events').upsert(payload, {
            onConflict: 'calendar_connection_id,provider_event_id',
          })
          if (imported.error) throw imported.error
        }
        importedEvents++
      }
      pageToken = page.nextPageToken
      nextSyncToken = page.nextSyncToken ?? nextSyncToken
    } while (pageToken)
  } catch (error) {
    if (
      error instanceof GoogleApiError &&
      error.status === 410 &&
      !input.forceFull
    ) {
      await admin
        .from('calendar_connections')
        .update({ sync_token: null })
        .eq('id', input.connectionId)
      return syncGoogleConnection({ ...input, forceFull: true })
    }
    throw error
  }

  let importedTasks = 0
  if (connection.selected_tasklist_id) {
    let taskPage: string | undefined
    do {
      const url = new URL(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(connection.selected_tasklist_id)}/tasks`,
      )
      url.searchParams.set('showCompleted', 'true')
      url.searchParams.set('showHidden', 'true')
      url.searchParams.set('showDeleted', 'true')
      url.searchParams.set('maxResults', '100')
      if (taskPage) url.searchParams.set('pageToken', taskPage)
      const page = await googleApi<{
        items?: Array<{
          id: string
          title: string
          notes?: string
          due?: string
          completed?: string
          status?: string
          deleted?: boolean
        }>
        nextPageToken?: string
      }>({ ...input, url })
      for (const task of page.items ?? []) {
        if (!task.id) continue
        if (task.deleted) {
          const removed = await admin
            .from('calendar_tasks')
            .delete()
            .eq('workspace_id', input.workspaceId)
            .eq('calendar_connection_id', input.connectionId)
            .eq('provider_task_id', task.id)
          if (removed.error) throw removed.error
          importedTasks++
          continue
        }
        const { error } = await admin.from('calendar_tasks').upsert(
          {
            workspace_id: input.workspaceId,
            calendar_connection_id: input.connectionId,
            provider: 'google',
            provider_task_id: task.id,
            tasklist_id: connection.selected_tasklist_id,
            title: task.title.slice(0, 180) || 'Tarefa Google',
            notes: task.notes?.slice(0, 8000) ?? null,
            due_at: task.due ?? null,
            completed_at: task.completed ?? null,
            status: task.status === 'completed' ? 'completed' : 'needs_action',
            sync_status: 'synced',
            sync_error: null,
          },
          { onConflict: 'calendar_connection_id,provider_task_id' },
        )
        if (error) throw error
        importedTasks++
      }
      taskPage = page.nextPageToken
    } while (taskPage)
  }
  const now = new Date().toISOString()
  await admin
    .from('calendar_connections')
    .update({
      sync_token: nextSyncToken ?? connection.sync_token,
      last_sync_at: now,
      connection_error: null,
    })
    .eq('id', input.connectionId)
  return { importedEvents, importedTasks, syncedAt: now }
}
