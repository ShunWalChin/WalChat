/** Autenticação e autorização multi-tenant para todas as APIs privadas. */
import '@tanstack/react-start/server-only'
import { ZodError } from 'zod'
import { getServerEnv } from './env.server'
import {
  getSupabaseAdmin,
  requireUserFromBearer,
} from './supabase-admin.server'

export type WorkspaceRole = 'owner' | 'admin' | 'agent' | 'viewer'

export async function requireWorkspaceContext(
  request: Request,
  allowedRoles: WorkspaceRole[] = ['owner', 'admin', 'agent', 'viewer'],
) {
  const user = await requireUserFromBearer(request)
  if (!user) throw new ApiError(401, 'Sessão inválida ou expirada.')

  const supabase = getSupabaseAdmin()
  if (!supabase) throw new ApiError(503, 'Backend Supabase indisponível.')

  let membershipQuery = supabase
    .from('workspace_members')
    .select('workspace_id,role,workspaces!inner(id,name,slug)')
    .eq('user_id', user.id)
  const requestedWorkspace = request.headers.get('x-workspace-id')
  if (requestedWorkspace)
    membershipQuery = membershipQuery.eq('workspace_id', requestedWorkspace)

  const { data: membership, error } = await membershipQuery
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!membership) throw new ApiError(403, 'Usuário não pertence ao workspace.')
  if (!allowedRoles.includes(membership.role as WorkspaceRole))
    throw new ApiError(403, 'Seu perfil não permite esta alteração.')

  return {
    user,
    workspaceId: membership.workspace_id as string,
    role: membership.role as WorkspaceRole,
    workspace: membership.workspaces as unknown as {
      id: string
      name: string
      slug: string
    },
    supabase,
  }
}

/** Reforça CSRF nas mutações sem impedir smoke tests server-to-server sem Origin. */
export function assertTrustedOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return
  if (new URL(origin).origin !== new URL(getServerEnv().APP_ORIGIN).origin)
    throw new ApiError(403, 'Origem da requisição não autorizada.')
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function apiErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status })
  if (error instanceof ZodError)
    return Response.json(
      { error: 'Dados inválidos.', details: error.flatten() },
      { status: 400 },
    )
  if (error instanceof Error && error.name === 'MetaApiError')
    return Response.json({ error: error.message }, { status: 502 })
  console.error('private_api_failed', error)
  return Response.json({ error: fallback }, { status: 500 })
}
