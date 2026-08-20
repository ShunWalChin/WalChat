/** Cacheia posts reais da conta Meta para o editor de Comment-to-DM. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { getMetaAccountAccess } from '../../../../server/integration-credentials.server'
import { getMetaMedia } from '../../../../server/meta-api.server'

const syncSchema = z.object({ accountId: z.string().uuid() })

export const Route = createFileRoute('/api/integrations/meta/media')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const { data, error } = await context.supabase
            .from('posts_cache')
            .select(
              'id,instagram_account_id,instagram_media_id,kind,caption,permalink,media_url,thumbnail_url,published_at',
            )
            .eq('workspace_id', context.workspaceId)
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(50)
          if (error) throw error
          return Response.json({ posts: data })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao listar posts da Meta.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = syncSchema.parse(await request.json())
          const access = await getMetaAccountAccess({
            workspaceId: context.workspaceId,
            instagramAccountId: body.accountId,
          })
          const result = await getMetaMedia({
            instagramUserId: access.instagramUserId,
            accessToken: access.accessToken,
          })
          const rows = (result.data ?? []).map((media) => ({
            workspace_id: context.workspaceId,
            instagram_account_id: body.accountId,
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
            raw_payload: media,
          }))
          if (rows.length > 0) {
            const { error } = await context.supabase
              .from('posts_cache')
              .upsert(rows, {
                onConflict: 'workspace_id,instagram_media_id',
              })
            if (error) throw error
          }
          return Response.json({ ok: true, synced: rows.length })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao sincronizar posts da Meta.')
        }
      },
    },
  },
})
