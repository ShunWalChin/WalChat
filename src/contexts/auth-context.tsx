/** Sessão compartilhada: Supabase Auth quando configurado e fallback no modo demo. */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { resetWorkspaceState } from '../lib/active-workspace'
import { getBrowserSupabase, isSupabaseConfigured } from '../lib/supabase'

type WalUser = { id: string; email: string; name: string }

type AuthContextValue = {
  user: WalUser | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  enterDemo: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const DEMO_KEY = 'wal-chat-demo-session'

/** Sincroniza sessão inicial, eventos de Auth, cadastro, login e logout. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<WalUser | null>(null)
  const [loading, setLoading] = useState(true)
  const configured = isSupabaseConfigured()

  useEffect(() => {
    const supabase = getBrowserSupabase()
    if (!supabase) {
      if (localStorage.getItem(DEMO_KEY)) {
        setUser({ id: 'demo', email: 'demo@walchat.local', name: 'Wal Demo' })
      }
      setLoading(false)
      return
    }

    void supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user
      if (sessionUser) {
        setUser({
          id: sessionUser.id,
          email: sessionUser.email ?? '',
          name: sessionUser.user_metadata.name ?? 'Criador',
        })
      }
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const sessionUser = session?.user
        setUser(
          sessionUser
            ? {
                id: sessionUser.id,
                email: sessionUser.email ?? '',
                name: sessionUser.user_metadata.name ?? 'Criador',
              }
            : null,
        )
      },
    )
    return () => subscription.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured,
      async signIn(email, password) {
        const supabase = getBrowserSupabase()
        if (!supabase) {
          if (email === 'demo@walchat.local' && password === 'wal123') {
            localStorage.setItem(DEMO_KEY, '1')
            setUser({ id: 'demo', email, name: 'Wal Demo' })
            return
          }
          throw new Error(
            'Use demo@walchat.local e senha wal123 no modo local.',
          )
        }
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
      },
      async signUp(name, email, password) {
        const supabase = getBrowserSupabase()
        if (!supabase)
          throw new Error('Inicie o Supabase local para criar contas.')
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        })
        if (error) throw error
      },
      enterDemo() {
        if (configured)
          throw new Error('Modo demo indisponível com autenticação real ativa.')
        localStorage.setItem(DEMO_KEY, '1')
        setUser({ id: 'demo', email: 'demo@walchat.local', name: 'Wal Demo' })
      },
      async signOut() {
        // Sem isto a próxima sessão herdaria o workspace da anterior.
        resetWorkspaceState()
        localStorage.removeItem(DEMO_KEY)
        const supabase = getBrowserSupabase()
        if (supabase) await supabase.auth.signOut()
        setUser(null)
      },
    }),
    [configured, loading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Exige que o consumidor esteja dentro de `AuthProvider`. */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa de AuthProvider')
  return context
}
