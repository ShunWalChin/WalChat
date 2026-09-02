/** Recupera comentários que não chegaram por webhook e vincula o próximo Reel. */
import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { getMetaAccountAccess } from './integration-credentials.server'
import { getMetaMedia, getMetaRecentComments } from './meta-api.server'
import type { MetaRecentComment } from './meta-api.server'
import { matchKeywordTerms, triggerKeywordTerms } from './keyword-matcher'
import { getSupabaseAdmin } from './supabase-admin.server'
import { processInstagramWebhook } from './webhook-processor.server'

export const COMMENT_RECONCILE_INTERVAL_MS = 5 * 60_000
export const COMMENT_RECONCILE_LOOKBACK_MS = 72 * 60 * 60_000
export const COMMENT_RECONCILE_MAX_PER_ACCOUNT = 30

type CommentTrigger = {
  id: string
  post_id: string | null
  keyword: string | null
  keywords: Array<string> | null
  match_mode: 'exact' | 'contains'
  instagram_account_id: string | null
  target_next_reel: boolean
}

type CachedPost = {
  id: string
  instagram_media_id: string
}

function requireAdmin() {
  const admin = getSupabaseAdmin()
  if (!admin)
    throw new Error('Supabase administrativo indisponível para reconciliação.')
  return admin
}

function safeOperationalCode(error: unknown) {
  if (error && typeof error === 'object' && 'status' in error)
    return `meta_http_${String(error.status).slice(0, 3)}`
  return error instanceof Error ? error.name.slice(0, 80) : 'unknown_error'
}

function webhookChanges(payload: unknown) {
  if (!payload || typeof payload !== 'object') return []
  const entries = Array.isArray((payload as { entry?: unknown }).entry)
    ? (payload as { entry: Array<unknown> }).entry
    : []
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const changes = (entry as { changes?: unknown }).changes
    return Array.isArray(changes) ? changes : []
  })
}

/** IDs de anúncios derivados de posts orgânicos, sem pedir ads_management. */
export function boostedMediaOrigins(
  payloads: Array<unknown>,
  organicMediaIds: Array<string>,
) {
  const organic = new Set(organicMediaIds)
  const origins = new Map<string, string>()
  for (const payload of payloads) {
    for (const change of webhookChanges(payload)) {
      if (!change || typeof change !== 'object') continue
      const record = change as {
        field?: unknown
        value?: { media?: Record<string, unknown> }
      }
      if (record.field !== 'comments') continue
      const media = record.value?.media
      const id = typeof media?.id === 'string' ? media.id : null
      const original =
        typeof media?.original_media_id === 'string'
          ? media.original_media_id
          : null
      if (id && original && id !== original && organic.has(original))
        origins.set(id, original)
    }
  }
  return origins
}

export function commentNeedsReconciliation(input: {
  comment: MetaRecentComment
  accountInstagramId: string
  triggers: Array<CommentTrigger>
}) {
  const authorId = input.comment.from?.id
  if (!authorId || authorId === input.accountInstagramId) return false
  if (
    input.comment.replies?.data?.some(
      (reply) => reply.from?.id === input.accountInstagramId,
    )
  )
    return false
  return input.triggers.some(
    (trigger) =>
      matchKeywordTerms(
        input.comment.text ?? '',
        triggerKeywordTerms(trigger),
        trigger.match_mode,
      ).matched,
  )
}

export function unreconciledCommentCandidates(
  comments: Array<MetaRecentComment>,
  seenIds: ReadonlySet<string>,
  limit: number,
) {
  return comments
    .filter((comment) => !seenIds.has(comment.id))
    .sort(
      (left, right) =>
        new Date(left.timestamp ?? 0).getTime() -
        new Date(right.timestamp ?? 0).getTime(),
    )
    .slice(0, Math.max(0, limit))
}

export function findNextReel<
  T extends {
    id: string
    media_product_type?: string
    timestamp?: string
  },
>(media: Array<T>, createdAt: string): T | null {
  const created = new Date(createdAt).getTime()
  const ordered = [...media]
    .filter(
      (item) =>
        item.media_product_type === 'REELS' &&
        Boolean(item.timestamp) &&
        new Date(item.timestamp as string).getTime() > created,
    )
    .sort(
      (left, right) =>
        new Date(left.timestamp as string).getTime() -
        new Date(right.timestamp as string).getTime(),
    )
  return ordered.length ? ordered[0] : null
}

/** Uma passagem limitada por todas as contas de Instagram elegíveis. */
export async function reconcileInstagramComments() {
  const admin = requireAdmin()
  const now = Date.now()
  const cutoff = now - COMMENT_RECONCILE_INTERVAL_MS
  const sinceMs = now - COMMENT_RECONCILE_LOOKBACK_MS
  const { data: accounts, error: accountsError } = await admin
    .from('instagram_accounts')
    .select(
      'id,workspace_id,instagram_user_id,last_comment_reconcile_at,status',
    )
    .eq('status', 'connected')
    .limit(50)
  if (accountsError) throw accountsError

  const summary = { checkedAccounts: 0, recoveredComments: 0, failures: 0 }
  for (const account of accounts.filter(
    (item) =>
      !item.last_comment_reconcile_at ||
      new Date(item.last_comment_reconcile_at).getTime() <= cutoff,
  )) {
    summary.checkedAccounts++
    try {
      const { data: triggerRows, error: triggerError } = await admin
        .from('triggers')
        .select(
          'id,post_id,keyword,keywords,match_mode,instagram_account_id,target_next_reel',
        )
        .eq('workspace_id', account.workspace_id)
        .eq('source', 'comment')
        .eq('is_active', true)
      if (triggerError) throw triggerError
      const triggers = (triggerRows as Array<CommentTrigger>).filter(
        (trigger) =>
          !trigger.target_next_reel &&
          (!trigger.instagram_account_id ||
            trigger.instagram_account_id === account.id),
      )
      if (!triggers.length) {
        await admin
          .from('instagram_accounts')
          .update({
            last_comment_reconcile_at: new Date().toISOString(),
            comment_reconcile_error: null,
          })
          .eq('id', account.id)
        continue
      }

      const postIds = Array.from(
        new Set(triggers.map((trigger) => trigger.post_id).filter(Boolean)),
      ) as Array<string>
      const postsResult = postIds.length
        ? await admin
            .from('posts_cache')
            .select('id,instagram_media_id')
            .eq('workspace_id', account.workspace_id)
            .eq('instagram_account_id', account.id)
            .in('id', postIds)
        : { data: [] as Array<CachedPost>, error: null }
      if (postsResult.error) throw postsResult.error
      const posts = postsResult.data as Array<CachedPost>
      const postMediaById = new Map(
        posts.map((post) => [post.id, post.instagram_media_id]),
      )
      const mediaOrigins = new Map<string, string | null>(
        posts.map((post) => [post.instagram_media_id, null]),
      )

      const access = await getMetaAccountAccess({
        workspaceId: account.workspace_id,
        instagramAccountId: account.id,
      })
      if (triggers.some((trigger) => !trigger.post_id)) {
        const recent = await getMetaMedia({
          instagramUserId: access.instagramUserId,
          accessToken: access.accessToken,
          limit: 10,
        })
        for (const item of recent.data ?? []) mediaOrigins.set(item.id, null)
      }

      if (posts.length) {
        const { data: webhookRows, error: webhookError } = await admin
          .from('webhook_events')
          .select('payload')
          .eq('workspace_id', account.workspace_id)
          .eq('provider', 'instagram')
          .eq('external_account_id', account.instagram_user_id)
          .gte(
            'received_at',
            new Date(now - 90 * 24 * 60 * 60_000).toISOString(),
          )
          .order('received_at', { ascending: false })
          .limit(500)
        if (webhookError) throw webhookError
        for (const [adId, originalId] of boostedMediaOrigins(
          webhookRows.map((row) => row.payload),
          posts.map((post) => post.instagram_media_id),
        ))
          mediaOrigins.set(adId, originalId)
      }

      let remaining = COMMENT_RECONCILE_MAX_PER_ACCOUNT
      for (const [mediaId, originalMediaId] of mediaOrigins) {
        if (remaining <= 0) break
        const applicable = triggers.filter((trigger) => {
          if (!trigger.post_id) return true
          const configuredMedia = postMediaById.get(trigger.post_id)
          return (
            configuredMedia === mediaId || configuredMedia === originalMediaId
          )
        })
        if (!applicable.length) continue
        const comments = await getMetaRecentComments({
          mediaId,
          accessToken: access.accessToken,
          sinceMs,
        })
        const matchingComments = comments.filter((comment) =>
          commentNeedsReconciliation({
            comment,
            accountInstagramId: access.instagramUserId,
            triggers: applicable,
          }),
        )
        if (!matchingComments.length) continue

        // Consulte em lotes para não estourar a URL do PostgREST. A deduplicação
        // acontece antes do limite por passagem: se os 30 comentários mais
        // antigos já estivessem gravados, aplicar slice antes faria os novos
        // ficarem bloqueados para sempre atrás deles.
        const seen = new Set<string>()
        for (let offset = 0; offset < matchingComments.length; offset += 100) {
          const chunk = matchingComments.slice(offset, offset + 100)
          const { data: existing, error: existingError } = await admin
            .from('interactions_log')
            .select('meta_event_id')
            .eq('workspace_id', account.workspace_id)
            .in(
              'meta_event_id',
              chunk.map((comment) => comment.id),
            )
          if (existingError) throw existingError
          for (const item of existing)
            if (item.meta_event_id) seen.add(item.meta_event_id)
        }

        const candidates = unreconciledCommentCandidates(
          matchingComments,
          seen,
          remaining,
        )
        for (const comment of candidates) {
          const timestamp = comment.timestamp
            ? Math.floor(new Date(comment.timestamp).getTime() / 1_000)
            : Math.floor(Date.now() / 1_000)
          const payload = {
            object: 'instagram',
            entry: [
              {
                id: access.instagramUserId,
                time: timestamp,
                changes: [
                  {
                    field: 'comments',
                    value: {
                      id: comment.id,
                      text: comment.text ?? '',
                      from: comment.from,
                      media: {
                        id: mediaId,
                        ...(originalMediaId
                          ? { original_media_id: originalMediaId }
                          : {}),
                      },
                    },
                  },
                ],
              },
            ],
          }
          const eventKey = createHash('sha256')
            .update(`poll:${account.id}:${comment.id}`)
            .digest('hex')
          const result = await processInstagramWebhook(payload, eventKey)
          if (result.processed > 0) {
            summary.recoveredComments++
            remaining--
          }
        }
      }

      const { error: accountUpdateError } = await admin
        .from('instagram_accounts')
        .update({
          last_comment_reconcile_at: new Date().toISOString(),
          comment_reconcile_error: null,
        })
        .eq('id', account.id)
      if (accountUpdateError) throw accountUpdateError
    } catch (caught) {
      summary.failures++
      await admin
        .from('instagram_accounts')
        .update({
          last_comment_reconcile_at: new Date().toISOString(),
          comment_reconcile_error: safeOperationalCode(caught),
        })
        .eq('id', account.id)
    }
  }
  return summary
}

/** Liga regras pendentes ao primeiro Reel posterior à criação da regra. */
export async function attachPendingNextReels() {
  const admin = requireAdmin()
  const { data: pending, error: pendingError } = await admin
    .from('triggers')
    .select(
      'id,workspace_id,instagram_account_id,created_at,target_next_reel,is_active',
    )
    .eq('target_next_reel', true)
    .eq('is_active', true)
    .limit(100)
  if (pendingError) throw pendingError

  let bound = 0
  const groups = new Map<
    string,
    { workspaceId: string; triggers: typeof pending }
  >()
  for (const trigger of pending) {
    if (!trigger.instagram_account_id) continue
    const current = groups.get(trigger.instagram_account_id)
    if (current) current.triggers.push(trigger)
    else
      groups.set(trigger.instagram_account_id, {
        workspaceId: trigger.workspace_id,
        triggers: [trigger],
      })
  }

  for (const [accountId, group] of groups) {
    try {
      const access = await getMetaAccountAccess({
        workspaceId: group.workspaceId,
        instagramAccountId: accountId,
      })
      const mediaResult = await getMetaMedia({
        instagramUserId: access.instagramUserId,
        accessToken: access.accessToken,
        limit: 25,
      })
      const media = mediaResult.data ?? []
      for (const trigger of group.triggers) {
        const reel = findNextReel(media, trigger.created_at)
        if (!reel) continue
        const postPayload = {
          workspace_id: group.workspaceId,
          instagram_account_id: accountId,
          instagram_media_id: reel.id,
          kind: 'reel',
          caption: reel.caption ?? null,
          permalink: reel.permalink ?? null,
          media_url: reel.media_url ?? null,
          thumbnail_url: reel.thumbnail_url ?? null,
          published_at: reel.timestamp ?? null,
          raw_payload: { mediaType: reel.media_type },
        }
        const { data: post, error: postError } = await admin
          .from('posts_cache')
          .upsert(postPayload, {
            onConflict: 'workspace_id,instagram_media_id',
          })
          .select('id')
          .single()
        if (postError) throw postError
        const { error: triggerError } = await admin
          .from('triggers')
          .update({ post_id: post.id, target_next_reel: false })
          .eq('id', trigger.id)
          .eq('target_next_reel', true)
        if (triggerError) throw triggerError
        bound++
      }
      await admin
        .from('instagram_accounts')
        .update({ last_next_reel_check_at: new Date().toISOString() })
        .eq('id', accountId)
    } catch (caught) {
      console.error(
        JSON.stringify({
          event: 'next_reel_attach_failed',
          accountId,
          error: safeOperationalCode(caught),
        }),
      )
    }
  }
  return { checkedAccounts: groups.size, bound }
}
