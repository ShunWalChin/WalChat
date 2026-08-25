/** Lista os workspaces do usuário para que a interface possa escolher um. */
import { createFileRoute } from '@tanstack/react-router'
import { ApiError, apiErrorResponse } from '../../server/api-auth.server'
import { assertRateLimit } from '../../server/rate-limit.server'
import {
  getSupabaseForRequest,
  requireUserFromBearer,
} from '../../server/supabase-admin.server'

type MembershipRow = {
  role: string
  workspace_id: string
  workspaces: { id: string; name: string; slug: string } | null
}

export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      // Este é o único endpoint privado que não pode exigir X-Workspace-Id: ele
      // existe justamente para descobrir quais workspaces o usuário tem.
      GET: async ({ request }) => {
        try {
          const user = await requireUserFromBearer(request)
          if (!user) throw new ApiError(401, 'Sessão inválida ou expirada.')
          await assertRateLimit({
            namespace: 'workspaces-list',
            identity: user.id,
            limit: 60,
            windowSeconds: 60,
          })
          const supabase = getSupabaseForRequest(request)
          if (!supabase)
            throw new ApiError(503, 'Backend Supabase indisponível.')

          // Cliente sujeito a RLS: a policy members_select já restringe as
          // linhas ao próprio usuário, e o filtro deixa a intenção explícita.
          const { data, error } = await supabase
            .from('workspace_members')
            .select('role,workspace_id,workspaces!inner(id,name,slug)')
            .eq('user_id', user.id)
            .limit(50)
          if (error) throw error

          const workspaces = (data as unknown as Array<MembershipRow>)
            .flatMap((membership) =>
              membership.workspaces
                ? [
                    {
                      id: membership.workspaces.id,
                      name: membership.workspaces.name,
                      slug: membership.workspaces.slug,
                      role: membership.role,
                    },
                  ]
                : [],
            )
            // Ordem estável: sem ela, "o primeiro workspace" mudaria entre
            // carregamentos e o usuário cairia em tenants diferentes.
            .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))

          return Response.json(
            { workspaces },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao consultar os workspaces do usuário.',
          )
        }
      },
    },
  },
})
