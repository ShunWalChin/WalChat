/** Finaliza OAuth Google e persiste tokens cifrados por conexão/tenant. */
import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'
import { getServerEnv } from '../../../../server/env.server'
import {
  consumeGoogleOAuthState,
  exchangeGoogleAuthorizationCode,
  getGoogleProfile,
  listGoogleCalendars,
  listGoogleTaskLists,
} from '../../../../server/google-calendar.server'
import {
  saveIntegrationCredential,
  writeIntegrationAudit,
} from '../../../../server/integration-credentials.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { requestIdentity } from '../../../../server/request-identity.server'
import { getSupabaseAdmin } from '../../../../server/supabase-admin.server'

function cookie(request: Request, name: string) {
  const secure = getServerEnv().APP_ORIGIN.startsWith('https://')
  const target = `${secure ? '__Host-' : ''}${name}`
  for (const item of request.headers.get('cookie')?.split(/;\s*/) ?? []) {
    const separator = item.indexOf('=')
    if (separator > 0 && item.slice(0, separator) === target)
      return item.slice(separator + 1)
  }
  return null
}

function equalState(left: string | null, right: string) {
  if (!left) return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function response(status: 'connected' | 'denied' | 'error') {
  const env = getServerEnv()
  const secure = env.APP_ORIGIN.startsWith('https://')
  const prefix = secure ? '__Host-' : ''
  const target = new URL('/calendario', env.APP_ORIGIN)
  target.searchParams.set('google', status)
  const clear = (name: string) =>
    [
      `${prefix}${name}=`,
      'HttpOnly',
      secure ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      'Max-Age=0',
    ]
      .filter(Boolean)
      .join('; ')
  const headers = new Headers({
    Location: target.toString(),
    'Cache-Control': 'no-store',
  })
  headers.append('Set-Cookie', clear('wal_google_oauth_state'))
  headers.append('Set-Cookie', clear('wal_google_pkce'))
  return new Response(null, {
    status: 303,
    headers,
  })
}

export const Route = createFileRoute('/api/integrations/google/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // O callback e anonimo por contrato do Google. O state de uso unico ja
        // impede a troca do code, mas sem cota cada tentativa ainda custa uma
        // ida ao Postgres.
        try {
          await assertRateLimit({
            namespace: 'google-oauth-callback',
            identity: requestIdentity(request),
            limit: 30,
            windowSeconds: 300,
          })
        } catch {
          return response('error')
        }
        const url = new URL(request.url)
        if (url.searchParams.get('error')) return response('denied')
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const verifier = cookie(request, 'wal_google_pkce')
        if (
          !code ||
          !state ||
          !verifier ||
          !equalState(cookie(request, 'wal_google_oauth_state'), state)
        )
          return response('error')
        let oauth: Awaited<ReturnType<typeof consumeGoogleOAuthState>> | null =
          null
        let connectionId: string | null = null
        try {
          oauth = await consumeGoogleOAuthState(state)
          const token = await exchangeGoogleAuthorizationCode(code, verifier)
          const profile = await getGoogleProfile(token.access_token)
          const admin = getSupabaseAdmin()
          if (!admin) throw new Error('Supabase administrativo indisponível.')
          const scopes = token.scope.split(/\s+/).filter(Boolean)
          const { data: connection, error } = await admin
            .from('calendar_connections')
            .upsert(
              {
                workspace_id: oauth.workspace_id,
                user_id: oauth.user_id,
                provider: 'google',
                provider_account_id: profile.sub,
                account_email: profile.email,
                display_name: profile.name ?? null,
                status: 'connected',
                scopes,
                connection_error: null,
              },
              { onConflict: 'workspace_id,user_id,provider' },
            )
            .select('id,selected_calendar_id,selected_tasklist_id')
            .single()
          if (error) throw error
          connectionId = connection.id
          const expiresAt = new Date(
            Date.now() + token.expires_in * 1_000,
          ).toISOString()
          await saveIntegrationCredential({
            workspaceId: oauth.workspace_id,
            provider: 'google',
            credentialType: 'access_token',
            scopeKey: connection.id,
            value: token.access_token,
            expiresAt,
            metadata: { tokenType: token.token_type, scopes },
          })
          if (token.refresh_token)
            await saveIntegrationCredential({
              workspaceId: oauth.workspace_id,
              provider: 'google',
              credentialType: 'refresh_token',
              scopeKey: connection.id,
              value: token.refresh_token,
              metadata: { scopes },
            })
          const [calendars, taskLists] = await Promise.all([
            listGoogleCalendars({
              workspaceId: oauth.workspace_id,
              connectionId: connection.id,
            }),
            listGoogleTaskLists({
              workspaceId: oauth.workspace_id,
              connectionId: connection.id,
            }),
          ])
          const selectedCalendar = calendars.find(
            (item) => item.id === connection.selected_calendar_id,
          ) ??
            calendars.find((item) => item.primary) ??
            calendars.at(0) ?? {
              id: 'primary',
              summary: 'Principal',
              primary: true,
              accessRole: 'writer',
            }
          const selectedTaskList =
            taskLists.find(
              (item) => item.id === connection.selected_tasklist_id,
            ) ?? taskLists.at(0)
          const update = await admin
            .from('calendar_connections')
            .update({
              available_calendars: calendars,
              available_tasklists: taskLists,
              selected_calendar_id: selectedCalendar.id,
              selected_calendar_name: selectedCalendar.summary,
              selected_tasklist_id: selectedTaskList
                ? selectedTaskList.id
                : null,
            })
            .eq('id', connection.id)
          if (update.error) throw update.error
          await writeIntegrationAudit({
            workspaceId: oauth.workspace_id,
            actorUserId: oauth.user_id,
            provider: 'google',
            action: 'calendar_connected',
            status: 'success',
            resourceId: connection.id,
            details: {
              scopes,
              calendars: calendars.length,
              taskLists: taskLists.length,
            },
          })
          return response('connected')
        } catch (error) {
          if (oauth) {
            const admin = getSupabaseAdmin()
            if (admin && connectionId)
              await admin
                .from('calendar_connections')
                .update({
                  status: 'error',
                  connection_error: 'oauth_callback_failed',
                })
                .eq('id', connectionId)
                .eq('workspace_id', oauth.workspace_id)
            await writeIntegrationAudit({
              workspaceId: oauth.workspace_id,
              actorUserId: oauth.user_id,
              provider: 'google',
              action: 'calendar_connected',
              status: 'failure',
              resourceId: connectionId,
            })
          }
          return response('error')
        }
      },
    },
  },
})
