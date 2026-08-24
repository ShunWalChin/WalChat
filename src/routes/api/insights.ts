/** Métricas consolidadas e sincronização manual read-only com a Meta. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { syncWorkspaceInstagramInsights } from '../../server/insights-sync.server'
import { assertRateLimit } from '../../server/rate-limit.server'
import { readJsonBody } from '../../server/request-body.server'

const syncSchema = z.object({ accountId: z.uuid() }).strict()

export const Route = createFileRoute('/api/insights')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [dailyResult, postsResult, accountsResult] = await Promise.all([
            context.supabase
              .from('insights_daily')
              .select(
                'day,reach,views,followers,dms_received,dms_sent,comments,new_contacts,hourly_activity',
              )
              .eq('workspace_id', context.workspaceId)
              .order('day', { ascending: true })
              .limit(90),
            context.supabase
              .from('posts_cache')
              .select(
                'id,caption,permalink,thumbnail_url,published_at,reach,views,likes,comments,saves,shares',
              )
              .eq('workspace_id', context.workspaceId)
              .order('reach', { ascending: false })
              .limit(10),
            context.supabase
              .from('instagram_accounts')
              .select('id,username,status,scopes')
              .eq('workspace_id', context.workspaceId)
              .eq('status', 'connected')
              .order('created_at'),
          ])
          if (dailyResult.error) throw dailyResult.error
          if (postsResult.error) throw postsResult.error
          if (accountsResult.error) throw accountsResult.error
          const totals = dailyResult.data.reduce(
            (result, day) => ({
              reach: result.reach + day.reach,
              views: result.views + day.views,
              dmsReceived: result.dmsReceived + day.dms_received,
              dmsSent: result.dmsSent + day.dms_sent,
              comments: result.comments + day.comments,
              newContacts: result.newContacts + day.new_contacts,
              followers: day.followers || result.followers,
            }),
            {
              reach: 0,
              views: 0,
              dmsReceived: 0,
              dmsSent: 0,
              comments: 0,
              newContacts: 0,
              followers: 0,
            },
          )
          return Response.json({
            daily: dailyResult.data.map((day) => ({
              day: day.day,
              reach: day.reach,
              views: day.views,
              followers: day.followers,
              dmsReceived: day.dms_received,
              dmsSent: day.dms_sent,
              comments: day.comments,
              newContacts: day.new_contacts,
              hourlyActivity: day.hourly_activity,
            })),
            posts: postsResult.data.map((post) => ({
              id: post.id,
              caption: post.caption,
              permalink: post.permalink,
              thumbnailUrl: post.thumbnail_url,
              publishedAt: post.published_at,
              reach: post.reach,
              views: post.views,
              likes: post.likes,
              comments: post.comments,
              saves: post.saves,
              shares: post.shares,
            })),
            accounts: accountsResult.data.map((account) => ({
              id: account.id,
              username: account.username,
              canSync: (account.scopes ?? []).includes(
                'instagram_business_manage_insights',
              ),
            })),
            totals,
            generatedAt: new Date().toISOString(),
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar insights.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'insights-sync',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 5,
            windowSeconds: 300,
          })
          const body = syncSchema.parse(await readJsonBody(request))
          const { count, error } = await context.supabase
            .from('instagram_accounts')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.accountId)
            .eq('status', 'connected')
          if (error) throw error
          if (!count)
            return Response.json(
              { error: 'Conta Instagram não está conectada.' },
              { status: 422 },
            )
          const result = await syncWorkspaceInstagramInsights({
            workspaceId: context.workspaceId,
            instagramAccountId: body.accountId,
          })
          return Response.json({ ok: true, ...result })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao sincronizar insights.')
        }
      },
    },
  },
})
