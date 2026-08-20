/** Estado sanitizado da conexão Google e seleção de calendário/lista. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { getServerEnv } from '../../../../server/env.server'
import {
  GOOGLE_WORKSPACE_SCOPES,
  googleWorkspaceConfigured,
} from '../../../../server/google-calendar.server'
import { readJsonBody } from '../../../../server/request-body.server'

const updateSchema = z.object({
  connectionId: z.uuid(),
  calendarId: z.string().min(1).max(1024),
  tasklistId: z.string().min(1).max(1024).nullable(),
})

export const Route = createFileRoute('/api/integrations/google/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [connectionResult, credentialResult] = await Promise.all([
            context.admin
              .from('calendar_connections')
              .select(
                'id,user_id,provider_account_id,account_email,display_name,status,scopes,selected_calendar_id,selected_calendar_name,selected_tasklist_id,available_calendars,available_tasklists,last_sync_at,connection_error,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at'),
            context.admin
              .from('integration_credentials')
              .select('scope_key,credential_type,expires_at')
              .eq('workspace_id', context.workspaceId)
              .eq('provider', 'google')
              .in('credential_type', ['access_token', 'refresh_token']),
          ])
          if (connectionResult.error) throw connectionResult.error
          if (credentialResult.error) throw credentialResult.error
          const credentials = credentialResult.data
          const connections = connectionResult.data.map((connection) => {
            const access = credentials.find(
              (item) =>
                item.scope_key === connection.id &&
                item.credential_type === 'access_token',
            )
            return {
              ...connection,
              tokenStored: Boolean(access),
              refreshTokenStored: credentials.some(
                (item) =>
                  item.scope_key === connection.id &&
                  item.credential_type === 'refresh_token',
              ),
              tokenExpiresAt: access?.expires_at ?? null,
            }
          })
          const env = getServerEnv()
          return Response.json(
            {
              platformConfigured: googleWorkspaceConfigured(),
              redirectUri:
                env.GOOGLE_OAUTH_REDIRECT_URI ??
                `${env.APP_ORIGIN}/api/integrations/google/callback`,
              requiredScopes: GOOGLE_WORKSPACE_SCOPES,
              connections,
              permissions: {
                canConnect:
                  context.role === 'owner' || context.role === 'admin',
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar o Google.')
        }
      },
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = updateSchema.parse(await readJsonBody(request))
          const connection = await context.admin
            .from('calendar_connections')
            .select('available_calendars,available_tasklists')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.connectionId)
            .maybeSingle()
          if (connection.error) throw connection.error
          if (!connection.data)
            throw new ApiError(404, 'Conexão não encontrada.')
          const calendars = Array.isArray(connection.data.available_calendars)
            ? (connection.data.available_calendars as Array<{
                id?: string
                summary?: string
              }>)
            : []
          const taskLists = Array.isArray(connection.data.available_tasklists)
            ? (connection.data.available_tasklists as Array<{ id?: string }>)
            : []
          const calendar = calendars.find((item) => item.id === body.calendarId)
          if (!calendar) throw new ApiError(422, 'Calendário não autorizado.')
          if (
            body.tasklistId &&
            !taskLists.some((item) => item.id === body.tasklistId)
          )
            throw new ApiError(422, 'Lista de tarefas não autorizada.')
          const { error } = await context.admin
            .from('calendar_connections')
            .update({
              selected_calendar_id: body.calendarId,
              selected_calendar_name: calendar.summary ?? 'Google Calendar',
              selected_tasklist_id: body.tasklistId,
              sync_token: null,
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.connectionId)
          if (error) throw error
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao salvar seleção Google.')
        }
      },
    },
  },
})
