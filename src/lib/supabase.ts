/** Cliente Supabase do navegador, criado sob demanda para evitar instâncias duplicadas. */
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null | undefined

/** Retorna `null` quando a interface está intencionalmente sem Supabase. */
export function getBrowserSupabase() {
  if (typeof window === 'undefined') return null
  if (browserClient !== undefined) return browserClient

  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  browserClient = url && anonKey ? createClient(url, anonKey) : null
  return browserClient
}

/** Informa ao login se deve usar Auth real ou o fallback visual de demonstração. */
export function isSupabaseConfigured() {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  )
}
