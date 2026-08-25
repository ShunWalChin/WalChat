/** Carrega os workspaces do usuário e mantém o tenant ativo da sessão. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { Workspace } from '../lib/active-workspace'
import {
  getActiveWorkspaceId,
  publishWorkspaces,
  releaseWorkspaceGate,
  resetWorkspaceState,
  setActiveWorkspaceId,
} from '../lib/active-workspace'
import { apiFetch } from '../lib/api-client'
import { useAuth } from './auth-context'

type WorkspaceContextValue = {
  workspaces: Array<Workspace>
  activeId: string | null
  active: Workspace | null
  loading: boolean
  error: string | null
  switchTo: (id: string) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, configured } = useAuth()
  const [workspaces, setWorkspaces] = useState<Array<Workspace>>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Modo demo e logout não têm workspace a resolver, mas as chamadas em voo
    // precisam ser liberadas do mesmo jeito ou ficariam esperando para sempre.
    if (!user || !configured) {
      resetWorkspaceState()
      releaseWorkspaceGate()
      setWorkspaces([])
      setActiveId(null)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    void apiFetch<{ workspaces: Array<Workspace> }>(
      '/api/workspaces',
      {},
      { workspaceScoped: false },
    )
      .then((payload) => {
        if (cancelled) return
        setWorkspaces(payload.workspaces)
        setActiveId(publishWorkspaces(payload.workspaces))
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // A interface segue utilizável: quem tem um único workspace continua
        // funcionando sem o header, e o erro fica visível no seletor.
        releaseWorkspaceGate()
        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível carregar seus workspaces.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [configured, user])

  const switchTo = useCallback(
    (id: string) => {
      if (!workspaces.some((workspace) => workspace.id === id)) return
      setActiveWorkspaceId(id)
      setActiveId(id)
      // Recarrega para que toda tela já montada volte a buscar dados do tenant
      // novo; manter caches de dois workspaces vivos ao mesmo tempo misturaria
      // dados de clientes diferentes na mesma tela.
      if (typeof window !== 'undefined') window.location.reload()
    },
    [workspaces],
  )

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeId: activeId ?? getActiveWorkspaceId(),
      active: workspaces.find((workspace) => workspace.id === activeId) ?? null,
      loading,
      error,
      switchTo,
    }),
    [activeId, error, loading, switchTo, workspaces],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

/** Devolve um estado vazio fora do provider para não derrubar telas públicas. */
export function useWorkspace() {
  return (
    useContext(WorkspaceContext) ?? {
      workspaces: [],
      activeId: null,
      active: null,
      loading: false,
      error: null,
      switchTo: () => undefined,
    }
  )
}
