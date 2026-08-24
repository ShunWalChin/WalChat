/** Sincronização read-only das métricas Meta com dados operacionais locais. */
import '@tanstack/react-start/server-only'
import { getMetaAccountAccess } from './integration-credentials.server'
import {
  MetaApiError,
  getMetaAccountInsights,
  getMetaMedia,
  getMetaMediaInsights,
} from './meta-api.server'
import type { MetaInsightMetric } from './meta-api.server'
import { getSupabaseAdmin } from './supabase-admin.server'

function requireSupabase() {
  const client = getSupabaseAdmin()
  if (!client) throw new Error('Supabase administrativo indisponível.')
  return client
}

function metricNumber(metric: MetaInsightMetric | undefined) {
  const total = metric?.total_value?.value
  if (typeof total === 'number') return total
  const last = metric?.values?.at(-1)?.value
  return typeof last === 'number' ? last : 0
}

function dailyMetric(metric: MetaInsightMetric | undefined, day: string) {
  const match = metric?.values?.find((value) =>
    value.end_time?.startsWith(day),
  )?.value
  return typeof match === 'number' ? match : 0
}

function dateDays(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setUTCHours(0, 0, 0, 0)
    date.setUTCDate(date.getUTCDate() - (count - index - 1))
    return date.toISOString().slice(0, 10)
  })
}

async function resilientMediaInsights(mediaId: string, accessToken: string) {
  const metrics = ['views', 'reach', 'likes', 'comments', 'saved', 'shares']
  try {
    return (
      (await getMetaMediaInsights({ mediaId, accessToken, metrics })).data ?? []
    )
  } catch (error) {
    if (!(error instanceof MetaApiError)) throw error
    const results = await Promise.allSettled(
      metrics.map((metric) =>
        getMetaMediaInsights({
          mediaId,
          accessToken,
          metrics: [metric],
        }),
      ),
    )
    return results.flatMap((result) =>
      result.status === 'fulfilled' ? (result.value.data ?? []) : [],
    )
  }
}

async function resilientAccountInsights(input: {
  instagramUserId: string
  accessToken: string
  since: string
  until: string
}) {
  const metrics = ['reach', 'views', 'follower_count', 'profile_views']
  try {
    return (
      (
        await getMetaAccountInsights({
          ...input,
          metrics,
        })
      ).data ?? []
    )
  } catch (error) {
    if (!(error instanceof MetaApiError)) throw error
    const results = await Promise.allSettled(
      metrics.map((metric) =>
        getMetaAccountInsights({ ...input, metrics: [metric] }),
      ),
    )
    const recovered = results.flatMap((result) =>
      result.status === 'fulfilled' ? (result.value.data ?? []) : [],
    )
    if (!recovered.length) throw error
    return recovered
  }
}

export async function syncWorkspaceInstagramInsights(input: {
  workspaceId: string
  instagramAccountId: string
}) {
  const supabase = requireSupabase()
  const access = await getMetaAccountAccess({
    workspaceId: input.workspaceId,
    instagramAccountId: input.instagramAccountId,
  })
  const days = dateDays(7)
  const since = `${days[0]}T00:00:00Z`
  const until = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  const [accountInsights, mediaResult, interactionsResult, contactsResult] =
    await Promise.all([
      resilientAccountInsights({
        instagramUserId: access.instagramUserId,
        accessToken: access.accessToken,
        since,
        until,
      }),
      getMetaMedia({
        instagramUserId: access.instagramUserId,
        accessToken: access.accessToken,
        limit: 25,
      }),
      supabase
        .from('interactions_log')
        .select('direction,channel,created_at')
        .eq('workspace_id', input.workspaceId)
        .gte('created_at', since)
        .limit(20_000),
      supabase
        .from('contacts')
        .select('first_seen_at')
        .eq('workspace_id', input.workspaceId)
        .gte('first_seen_at', since)
        .limit(20_000),
    ])
  if (interactionsResult.error) throw interactionsResult.error
  if (contactsResult.error) throw contactsResult.error
  const metrics = new Map(
    accountInsights.map((metric) => [metric.name, metric]),
  )
  const rows = days.map((day) => {
    const dayInteractions = interactionsResult.data.filter((item) =>
      item.created_at.startsWith(day),
    )
    const hourlyActivity: Record<string, number> = {}
    for (const interaction of dayInteractions.filter(
      (item) => item.direction === 'inbound',
    )) {
      const hour = String(new Date(interaction.created_at).getUTCHours())
      hourlyActivity[hour] = (hourlyActivity[hour] ?? 0) + 1
    }
    return {
      workspace_id: input.workspaceId,
      instagram_account_id: input.instagramAccountId,
      day,
      reach: dailyMetric(metrics.get('reach'), day),
      views: dailyMetric(metrics.get('views'), day),
      // Campo legado preservado para dashboards antigos; desde v22 usamos views.
      impressions: dailyMetric(metrics.get('views'), day),
      followers: dailyMetric(metrics.get('follower_count'), day),
      dms_received: dayInteractions.filter(
        (item) => item.direction === 'inbound' && item.channel === 'dm',
      ).length,
      dms_sent: dayInteractions.filter(
        (item) => item.direction === 'outbound' && item.channel === 'dm',
      ).length,
      comments: dayInteractions.filter((item) => item.channel === 'comment')
        .length,
      new_contacts: contactsResult.data.filter((item) =>
        item.first_seen_at.startsWith(day),
      ).length,
      hourly_activity: hourlyActivity,
    }
  })
  const { error: dailyError } = await supabase
    .from('insights_daily')
    .upsert(rows, { onConflict: 'workspace_id,day' })
  if (dailyError) throw dailyError

  const mediaRows = []
  for (const media of mediaResult.data ?? []) {
    const mediaInsights = await resilientMediaInsights(
      media.id,
      access.accessToken,
    )
    const byName = new Map(mediaInsights.map((metric) => [metric.name, metric]))
    mediaRows.push({
      workspace_id: input.workspaceId,
      instagram_account_id: input.instagramAccountId,
      instagram_media_id: media.id,
      kind:
        media.media_type === 'CAROUSEL_ALBUM'
          ? 'carousel'
          : media.media_product_type === 'REELS'
            ? 'reel'
            : 'feed',
      caption: media.caption ?? null,
      permalink: media.permalink ?? null,
      media_url: media.media_url ?? null,
      thumbnail_url: media.thumbnail_url ?? null,
      published_at: media.timestamp ?? null,
      views: metricNumber(byName.get('views')),
      impressions: metricNumber(byName.get('views')),
      reach: metricNumber(byName.get('reach')),
      likes: metricNumber(byName.get('likes')),
      comments: metricNumber(byName.get('comments')),
      saves: metricNumber(byName.get('saved')),
      shares: metricNumber(byName.get('shares')),
      raw_payload: { mediaType: media.media_type },
    })
  }
  if (mediaRows.length > 0) {
    const { error: mediaError } = await supabase
      .from('posts_cache')
      .upsert(mediaRows, { onConflict: 'workspace_id,instagram_media_id' })
    if (mediaError) throw mediaError
  }
  return {
    days: rows.length,
    posts: mediaRows.length,
    followers: metricNumber(metrics.get('follower_count')),
  }
}
