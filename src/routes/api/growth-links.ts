/**
 * Links de captação com origem rastreada.
 *
 * O `ref` é a chave que a Meta devolve no webhook, então ele é único por
 * workspace: duas campanhas com o mesmo código ficariam indistinguíveis no
 * relatório e a atribuição erraria em silêncio.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import {
  buildGrowthUrl,
  growthLinkSchema,
  refFromName,
} from '../../server/growth-links'
import { assertRateLimit } from '../../server/rate-limit.server'
import { readJsonBody } from '../../server/request-body.server'

const createSchema = growthLinkSchema.partial({ ref: true }).extend({
  name: z.string().trim().min(2).max(80),
})

const deleteSchema = z.object({ id: z.uuid() }).strict()

export const Route = createFileRoute('/api/growth-links')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [linksResult, accountResult] = await Promise.all([
            context.supabase
              .from('growth_links')
              .select(
                'id,name,ref,is_active,flow_id,clicks,last_click_at,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at', { ascending: false })
              .limit(100),
            context.supabase
              .from('instagram_accounts')
              .select('username')
              .eq('workspace_id', context.workspaceId)
              .eq('status', 'connected')
              .order('last_sync_at', { ascending: false, nullsFirst: false })
              .limit(1)
              .maybeSingle(),
          ])
          if (linksResult.error) throw linksResult.error
          if (accountResult.error) throw accountResult.error

          const username = accountResult.data?.username ?? null
          return Response.json(
            {
              username,
              links: linksResult.data.map((link) => ({
                ...link,
                url: username ? buildGrowthUrl(username, link.ref) : null,
              })),
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao listar os links.')
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
            namespace: 'growth-links-create',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 30,
            windowSeconds: 60,
          })
          const body = createSchema.parse(await readJsonBody(request))

          // O código sai do nome quando o operador não escolhe um: pedir os dois
          // obrigaria a entender o mecanismo para criar um link.
          const { data: existentes, error: listError } = await context.supabase
            .from('growth_links')
            .select('ref')
            .eq('workspace_id', context.workspaceId)
          if (listError) throw listError
          const ref =
            body.ref ??
            refFromName(
              body.name,
              existentes.map((item) => item.ref),
            )

          const validated = growthLinkSchema.parse({ ...body, ref })

          const { data, error } = await context.admin
            .from('growth_links')
            .insert({
              workspace_id: context.workspaceId,
              name: validated.name,
              ref: validated.ref,
              is_active: validated.isActive,
              flow_id: validated.flowId ?? null,
              created_by: context.user.id,
            })
            .select('id,name,ref,is_active,flow_id,clicks')
            .single()
          if (error) {
            if (error.code === '23505')
              throw new ApiError(
                409,
                'Já existe um link com este código de origem.',
              )
            throw error
          }
          return Response.json({ created: true, link: data }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar o link.')
        }
      },

      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const { id } = deleteSchema.parse(await readJsonBody(request))
          // Desativa em vez de apagar: o `growth_ref` já gravado nos contatos
          // continuaria apontando para um link inexistente, e o histórico de
          // origem perderia o significado.
          const { error } = await context.admin
            .from('growth_links')
            .update({ is_active: false })
            .eq('workspace_id', context.workspaceId)
            .eq('id', id)
          if (error) throw error
          return Response.json({ deactivated: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao desativar o link.')
        }
      },
    },
  },
})
