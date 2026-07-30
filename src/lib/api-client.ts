/** Fetch autenticado para as APIs privadas do Wal Chat. */
import { getBrowserSupabase } from './supabase'

export async function apiFetch<T>(path: string, init: RequestInit = {}) {
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
  const response = await fetch(path, { ...init, headers })
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null
  if (!response.ok)
    throw new Error(payload?.error ?? `Falha HTTP ${response.status}.`)
  return payload as T
}
