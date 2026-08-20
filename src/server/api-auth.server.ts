/** Autenticação e autorização multi-tenant para todas as APIs privadas. */
import '@tanstack/react-start/server-only'
import { ZodError } from 'zod'
import { getServerEnv } from './env.server'
import {
  getSupabaseAdmin,
  getSupabaseForRequest,
  requireUserFromBearer,
} from './supabase-admin.server'

export type WorkspaceRole = 'owner' | 'admin' | 'agent' | 'viewer'

export async function requireWorkspaceContext(
  request: Request,
  allowedRoles: WorkspaceRole[] = ['owner', 'admin', 'agent', 'viewer'],
) {
  const user = await requireUserFromBearer(request)
  if (!user) throw new ApiError(401, 'Sessão inválida ou expirada.')

  const admin = getSupabaseAdmin()
  const supabase = getSupabaseForRequest(request)
  if (!admin || !supabase)
    throw new ApiError(503, 'Backend Supabase indisponível.')

  let membershipQuery = supabase
    .from('workspace_members')
    .select('workspace_id,role,workspaces!inner(id,name,slug)')
    .eq('user_id', user.id)
  const requestedWorkspace = request.headers.get('x-workspace-id')
  if (
    requestedWorkspace &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestedWorkspace,
    )
  )
    throw new ApiError(400, 'X-Workspace-Id inválido.')
  if (requestedWorkspace)
    membershipQuery = membershipQuery.eq('workspace_id', requestedWorkspace)

  const { data: memberships, error } = await membershipQuery.limit(2)
  if (error) throw error
  if (!requestedWorkspace && memberships.length > 1)
    throw new ApiError(
      409,
      'Selecione um workspace e envie o header X-Workspace-Id.',
    )
  const membership = memberships.at(0)
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
    /** Service role somente para mutações internas já autorizadas por esta API. */
    admin,
  }
}

/** Reforça CSRF nas mutações sem impedir smoke tests server-to-server sem Origin. */
export function assertTrustedOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new ApiError(403, 'Origem da requisição não autorizada.')
  if (!origin) return
  let trusted = false
  try {
    trusted =
      new URL(origin).origin === new URL(getServerEnv().APP_ORIGIN).origin
  } catch {
    trusted = false
  }
  if (!trusted) throw new ApiError(403, 'Origem da requisição não autorizada.')
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
  console.error(
    JSON.stringify({
      event: 'private_api_failed',
      error: error instanceof Error ? error.name : 'unknown_error',
    }),
  )
  return Response.json({ error: fallback }, { status: 500 })
}
