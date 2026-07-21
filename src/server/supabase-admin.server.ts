/** Cliente administrativo server-only usado por APIs internas e workers. */
import '@tanstack/react-start/server-only'
import { createClient } from '@supabase/supabase-js'
import { getServerEnv } from './env.server'

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
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : null
  const supabase = getSupabaseAdmin()
  if (!token || !supabase) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error) return null
  return data.user
}
