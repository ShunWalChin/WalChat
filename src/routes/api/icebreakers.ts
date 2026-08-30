/**
 * Perguntas prontas exibidas antes de a pessoa digitar.
 *
 * Vivem no perfil de mensagens da conta, na Meta — não no nosso banco. Guardar
 * uma cópia local criaria uma segunda fonte de verdade que divergiria no
 * primeiro erro de publicação, então a tela lê e escreve direto lá.
 */
import { createFileRoute } from '@tanstack/react-router'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { icebreakersSchema } from '../../server/icebreakers'
import { getMetaAccountAccess } from '../../server/integration-credentials.server'
import {
  getInstagramIcebreakers,
  setInstagramIcebreakers,
} from '../../server/meta-api.server'
import { assertRateLimit } from '../../server/rate-limit.server'
import { readJsonBody } from '../../server/request-body.server'

/** Resolve a conta conectada do workspace, que é onde as perguntas vivem. */
async function contaConectada(
  supabase: Awaited<ReturnType<typeof requireWorkspaceContext>>['supabase'],
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select('id,username')
    .eq('workspace_id', workspaceId)
    .eq('status', 'connected')
    .order('last_sync_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data)
    throw new ApiError(
      409,
      'Conecte uma conta do Instagram antes de configurar as perguntas.',
    )
  return data
}

export const Route = createFileRoute('/api/icebreakers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const conta = await contaConectada(
            context.supabase,
            context.workspaceId,
          )
          const acesso = await getMetaAccountAccess({
            workspaceId: context.workspaceId,
            instagramAccountId: conta.id,
          })
          if (!acesso.accessToken || !acesso.instagramUserId)
            throw new ApiError(409, 'Credencial da conta está incompleta.')

          const icebreakers = await getInstagramIcebreakers({
            instagramUserId: acesso.instagramUserId,
            accessToken: acesso.accessToken,
          })
          return Response.json(
            { username: conta.username, icebreakers },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao ler as perguntas.')
        }
      },

      PUT: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'icebreakers-save',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 20,
            windowSeconds: 60,
          })
          const icebreakers = icebreakersSchema.parse(
            await readJsonBody(request),
          )
          const conta = await contaConectada(
            context.supabase,
            context.workspaceId,
          )
          const acesso = await getMetaAccountAccess({
            workspaceId: context.workspaceId,
            instagramAccountId: conta.id,
          })
          if (!acesso.accessToken || !acesso.instagramUserId)
            throw new ApiError(409, 'Credencial da conta está incompleta.')

          await setInstagramIcebreakers({
            instagramUserId: acesso.instagramUserId,
            accessToken: acesso.accessToken,
            icebreakers,
          })
          return Response.json({ saved: true, count: icebreakers.length })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao publicar as perguntas.')
        }
      },
    },
  },
})
