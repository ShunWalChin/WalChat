/** Preferências auditáveis do módulo cuja ação externa não existe na API oficial. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { readJsonBody } from '../../server/request-body.server'

const settingsSchema = z
  .object({
    mode: z.enum(['all', 'positive', 'keyword']),
    keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
    requestedEnabled: z.boolean(),
  })
  .strict()

const officialDocumentation =
  'https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api'

export const Route = createFileRoute('/api/auto-like')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [{ data, error }, { count: comments, error: commentsError }] =
            await Promise.all([
              context.supabase
                .from('auto_like_settings')
                .select(
                  'mode,keywords,requested_enabled,capability_supported,updated_at',
                )
                .eq('workspace_id', context.workspaceId)
                .maybeSingle(),
              context.supabase
                .from('interactions_log')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', context.workspaceId)
                .eq('channel', 'comment')
                .eq('direction', 'inbound')
                .gte(
                  'created_at',
                  new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
                ),
            ])
          if (error) throw error
          if (commentsError) throw commentsError
          return Response.json({
            settings: {
              mode: data?.mode ?? 'positive',
              keywords: data?.keywords ?? [
                'quero',
                'link',
                'preço',
                'valor',
                'aula',
              ],
              requestedEnabled: data?.requested_enabled ?? false,
              capabilitySupported: false,
              effectiveEnabled: false,
              updatedAt: data?.updated_at ?? null,
            },
            activity: { commentsToday: comments ?? 0, likesExecuted: 0 },
            capability: {
              code: 'instagram_comment_like_not_available',
              explanation:
                'A API oficial atual permite moderar e responder comentários, mas não curtir comentários em nome da conta.',
              officialDocumentation,
            },
            permissions: {
              canManage: ['owner', 'admin'].includes(context.role),
            },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar auto-like.')
        }
      },
      PUT: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = settingsSchema.parse(await readJsonBody(request))
          const keywords = [
            ...new Set(
              body.keywords.map((keyword) =>
                keyword.normalize('NFKC').toLocaleLowerCase('pt-BR'),
              ),
            ),
          ]
          const { error } = await context.admin
            .from('auto_like_settings')
            .upsert(
              {
                workspace_id: context.workspaceId,
                mode: body.mode,
                keywords,
                requested_enabled: body.requestedEnabled,
                capability_supported: false,
                updated_by: context.user.id,
              },
              { onConflict: 'workspace_id' },
            )
          if (error) throw error
          return Response.json({
            ok: true,
            effectiveEnabled: false,
            warning: body.requestedEnabled
              ? 'Preferência salva, mas nenhuma curtida será executada porque a API oficial não oferece essa ação.'
              : null,
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao salvar auto-like.')
        }
      },
    },
  },
})
