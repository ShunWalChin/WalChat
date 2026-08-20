/** Cliente administrativo server-only usado por APIs internas e workers. */
import '@tanstack/react-start/server-only'
import { createClient } from '@supabase/supabase-js'
import { getServerEnv } from './env.server'

const BEARER_PATTERN = /^Bearer\s+([^\s]+)$/i

/** Extrai um JWT bearer sem aceitar espaços, múltiplos valores ou tokens gigantes. */
export function getBearerToken(request: Request) {
  const match = BEARER_PATTERN.exec(request.headers.get('authorization') ?? '')
  const token = match?.[1]
  return token && token.length <= 16_384 ? token : null
}

/** Retorna `null` em modo puramente visual e nunca persiste sessão da service role. */
export function getSupabaseAdmin() {
  const env = getServerEnv()
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Valida um JWT bearer diretamente no Supabase Auth e retorna o usuário autenticado. */
export async function requireUserFromBearer(request: Request) {
  const token = getBearerToken(request)
  const supabase = getSupabaseAdmin()
  if (!token || !supabase) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error) return null
  return data.user
}

/**
 * Cliente limitado ao JWT do usuário. Todas as consultas feitas por ele passam
 * por RLS; a service role fica separada para operações internas explícitas.
 */
export function getSupabaseForRequest(request: Request) {
  const env = getServerEnv()
  const token = getBearerToken(request)
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !token) return null
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}
