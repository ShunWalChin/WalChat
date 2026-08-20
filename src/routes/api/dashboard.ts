/** Painel dos últimos sete dias combinando Instagram, WhatsApp e CRM real. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../server/api-auth.server'

export const Route = createFileRoute('/api/dashboard')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const since = new Date(Date.now() - 7 * 24 * 60 * 60_000)
          const [
            insightsResult,
            activityDailyResult,
            recentInteractionsResult,
            newContactsResult,
            totalContactsResult,
            instagramResult,
            whatsappResult,
          ] = await Promise.all([
            context.supabase
              .from('insights_daily')
              .select('day,reach,dms_received,dms_sent,comments,new_contacts')
              .eq('workspace_id', context.workspaceId)
              .gte('day', since.toISOString().slice(0, 10))
              .order('day'),
            context.supabase
              .from('meta_activity_daily_last_7_days')
              .select('day,dms_received,dms_sent,comments,interactions')
              .eq('workspace_id', context.workspaceId)
              .order('day'),
            context.supabase
              .from('interactions_log')
              .select(
                'id,platform,contact_id,direction,channel,status,message_text,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .gte('created_at', since.toISOString())
              .order('created_at', { ascending: false })
              .limit(8),
            context.supabase
              .from('contacts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .gte('first_seen_at', since.toISOString()),
            context.supabase
              .from('contacts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId),
            context.supabase
              .from('instagram_accounts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('status', 'connected'),
            context.supabase
              .from('whatsapp_accounts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('status', 'connected'),
          ])
          for (const result of [
            insightsResult,
            activityDailyResult,
            recentInteractionsResult,
            newContactsResult,
            totalContactsResult,
            instagramResult,
            whatsappResult,
          ])
            if (result.error) throw result.error

          const activityDaily = activityDailyResult.data ?? []
          const recentInteractions = recentInteractionsResult.data ?? []
          const insights = insightsResult.data ?? []
          const dmsReceived = activityDaily.reduce(
            (total, item) => total + Number(item.dms_received ?? 0),
            0,
          )
          const dmsSent = activityDaily.reduce(
            (total, item) => total + Number(item.dms_sent ?? 0),
            0,
          )
          const comments = activityDaily.reduce(
            (total, item) => total + Number(item.comments ?? 0),
            0,
          )
          const reach = insights.reduce(
            (total, item) => total + Number(item.reach ?? 0),
            0,
          )

          const chartByDay = new Map(
            insights.map((item) => [
              item.day,
              { day: item.day, reach: Number(item.reach ?? 0), messages: 0 },
            ]),
          )
          for (let offset = 6; offset >= 0; offset--) {
            const day = new Date()
            day.setHours(0, 0, 0, 0)
            day.setDate(day.getDate() - offset)
            const key = day.toISOString().slice(0, 10)
            if (!chartByDay.has(key))
              chartByDay.set(key, { day: key, reach: 0, messages: 0 })
          }
          for (const activity of activityDaily) {
            const key = activity.day
            const current = chartByDay.get(key)
            if (current) current.messages = Number(activity.interactions ?? 0)
          }
          const chart = Array.from(chartByDay.values())
            .sort((left, right) => left.day.localeCompare(right.day))
            .slice(-7)

          const recent = recentInteractions
          const contactIds = Array.from(
            new Set(recent.map((item) => item.contact_id).filter(Boolean)),
          ) as string[]
          const { data: recentContacts, error: contactsError } =
            contactIds.length
              ? await context.supabase
                  .from('contacts')
                  .select('id,full_name,username,phone,whatsapp_user_id')
                  .eq('workspace_id', context.workspaceId)
                  .in('id', contactIds)
              : { data: [], error: null }
          if (contactsError) throw contactsError
          const contactsById = new Map(
            recentContacts.map((contact) => [contact.id, contact]),
          )

          return Response.json(
            {
              summary: {
                accountsReached: reach,
                dmsReceived,
                dmsSent,
                comments,
                newContacts: newContactsResult.count ?? 0,
                totalContacts: totalContactsResult.count ?? 0,
              },
              channels: {
                instagram: instagramResult.count ?? 0,
                whatsapp: whatsappResult.count ?? 0,
              },
              chart,
              activity: recent.map((item) => {
                const contact = item.contact_id
                  ? contactsById.get(item.contact_id)
                  : null
                const identity =
                  item.platform === 'whatsapp'
                    ? (contact?.phone ??
                      contact?.whatsapp_user_id ??
                      'WhatsApp')
                    : `@${contact?.username ?? 'instagram'}`
                return {
                  id: item.id,
                  platform:
                    item.platform === 'whatsapp' ? 'whatsapp' : 'instagram',
                  title:
                    item.direction === 'inbound'
                      ? `Mensagem recebida de ${contact?.full_name ?? identity}`
                      : `Mensagem enviada para ${contact?.full_name ?? identity}`,
                  meta:
                    item.message_text?.slice(0, 100) ??
                    `${item.channel} · ${item.status}`,
                  createdAt: item.created_at,
                }
              }),
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar o dashboard.')
        }
      },
    },
  },
})
