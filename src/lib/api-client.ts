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

/**
 * Monta os cabeçalhos autenticados de uma chamada.
 *
 * Vive separado porque `apiFetch` e `apiFetchText` diferem apenas em como leem
 * o corpo. Enquanto os dois montavam a própria autenticação, uma mudança aqui
 * — renovar token expirado, trocar o nome do header de workspace — precisava
 * ser lembrada nos dois lugares, e esquecer não quebra build nem teste: só o
 * caminho menos usado para de funcionar, calado.
 */
async function authHeaders(init: RequestInit, options: ApiFetchOptions) {
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
  return headers
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
) {
  const headers = await authHeaders(init, options)
  const response = await fetch(path, { ...init, headers })
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null
  if (!response.ok)
    throw new Error(payload?.error ?? `Falha HTTP ${response.status}.`)
  // Uma rota chamada com método que ela não implementa cai no catch-all da
  // aplicação e devolve a página HTML com status 200. Sem esta checagem o
  // `payload` vira `null`, a resposta passa por sucesso e quem chamou segue
  // como se a escrita tivesse acontecido. Aconteceu duas vezes durante os
  // testes de hoje, e nas duas o sinal foi indistinguível de um 200 legítimo.
  if (payload === null)
    throw new Error(
      `Resposta inesperada de ${path}: o servidor não devolveu JSON. Verifique o método HTTP da chamada.`,
    )
  return payload as T
}

/**
 * Versão que devolve texto cru, para respostas que não são JSON.
 *
 * O QR chega como SVG; passá-lo por `response.json()` quebraria. Reaproveita a
 * mesma autenticação e o mesmo portão de workspace.
 */
export async function apiFetchText(path: string, init: RequestInit = {}) {
  const headers = await authHeaders(init, {})
  const response = await fetch(path, { ...init, headers })
  const texto = await response.text()
  if (!response.ok) {
    // O erro do backend vem em JSON mesmo quando o sucesso não vem — mas nem
    // sempre: uma página de erro do proxy chega como HTML. O `try` cobre só a
    // leitura, e nunca o `throw`. Na versão anterior o `throw` ficava dentro
    // dele e era capturado pelo próprio `catch`, que comparava a mensagem com
    // a string exata 'Unexpected token'. Como o SyntaxError real traz o token
    // e o trecho do documento, a comparação nunca batia e o erro cru vazava
    // para a tela no lugar do texto pretendido.
    let doBackend: string | null = null
    try {
      doBackend = (JSON.parse(texto) as { error?: string }).error ?? null
    } catch {
      doBackend = null
    }
    throw new Error(doBackend ?? `Falha HTTP ${response.status}.`)
  }
  return texto
}
