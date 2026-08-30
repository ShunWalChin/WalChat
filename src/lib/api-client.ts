/** Fetch autenticado para as APIs privadas do Wal Chat. */
import { getActiveWorkspaceId, whenWorkspaceReady } from './active-workspace'
import { getBrowserSupabase } from './supabase'

type ApiFetchOptions = {
  /**
   * `/api/workspaces` é a única rota que precisa sair antes de sabermos qual é
   * o workspace ativo; esperar por ele ali travaria a própria descoberta.
   */
  workspaceScoped?: boolean
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
) {
  const supabase = getBrowserSupabase()
  const token = supabase
    ? (await supabase.auth.getSession()).data.session?.access_token
    : null
  if (!token)
    throw new Error(
      'Entre com uma conta Supabase real para configurar integrações.',
    )

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json')

  if (options.workspaceScoped !== false) {
    // Sem esta espera, uma chamada disparada durante o carregamento sairia sem
    // o header e o backend responderia 409 a quem tem mais de um workspace.
    await whenWorkspaceReady()
    const workspaceId = getActiveWorkspaceId()
    if (workspaceId) headers.set('X-Workspace-Id', workspaceId)
  }

  const response = await fetch(path, { ...init, headers })
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null
  if (!response.ok)
    throw new Error(payload?.error ?? `Falha HTTP ${response.status}.`)
  return payload as T
}

/**
 * Versão que devolve texto cru, para respostas que não são JSON.
 *
 * O QR chega como SVG; passá-lo por `response.json()` quebraria. Reaproveita a
 * mesma autenticação e o mesmo portão de workspace.
 */
export async function apiFetchText(path: string, init: RequestInit = {}) {
  const supabase = getBrowserSupabase()
  const token = supabase
    ? (await supabase.auth.getSession()).data.session?.access_token
    : null
  if (!token) throw new Error('Entre com uma conta Supabase real.')

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  await whenWorkspaceReady()
  const workspaceId = getActiveWorkspaceId()
  if (workspaceId) headers.set('X-Workspace-Id', workspaceId)

  const response = await fetch(path, { ...init, headers })
  const texto = await response.text()
  if (!response.ok) {
    // O erro do backend vem em JSON mesmo quando o sucesso não vem.
    try {
      throw new Error(
        (JSON.parse(texto) as { error?: string }).error ??
          `Falha HTTP ${response.status}.`,
      )
    } catch (causa) {
      if (causa instanceof Error && causa.message !== 'Unexpected token')
        throw causa
      throw new Error(`Falha HTTP ${response.status}.`)
    }
  }
  return texto
}
