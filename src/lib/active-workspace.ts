/**
 * Workspace ativo do navegador.
 *
 * Vive fora do React porque `apiFetch` precisa ler o valor sem estar dentro de
 * um componente. O `ready` existe para resolver uma corrida real: o shell
 * dispara chamadas assim que o usuário aparece, e uma chamada que saia antes da
 * lista de workspaces carregar iria sem o header — o que devolve `409` para
 * quem pertence a mais de um workspace.
 */
export type Workspace = {
  id: string
  name: string
  slug: string
  role: string
}

const STORAGE_KEY = 'wal-chat-workspace'

let activeId: string | null = null
let resolveReady: (() => void) | undefined
let ready = new Promise<void>((resolve) => {
  resolveReady = resolve
})

function readStored() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Navegação privada com storage bloqueado não deve derrubar a aplicação.
    return null
  }
}

function writeStored(id: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Sem persistência a escolha vale só para esta aba; seguir é melhor que falhar.
  }
}

export function getActiveWorkspaceId() {
  return activeId
}

/** Aguarda a lista de workspaces ser resolvida — inclusive quando está vazia. */
export function whenWorkspaceReady() {
  return ready
}

export function setActiveWorkspaceId(id: string | null) {
  activeId = id
  writeStored(id)
}

/**
 * Publica a lista carregada e escolhe o workspace ativo: mantém o que estava
 * salvo quando ele ainda existe, senão cai no primeiro da ordem estável.
 */
export function publishWorkspaces(workspaces: Array<Workspace>) {
  const stored = readStored()
  const kept = workspaces.find((workspace) => workspace.id === stored)
  setActiveWorkspaceId(kept?.id ?? workspaces.at(0)?.id ?? null)
  resolveReady?.()
  return getActiveWorkspaceId()
}

/** Libera as chamadas quando não há workspace algum a resolver (demo, erro, logout). */
export function releaseWorkspaceGate() {
  resolveReady?.()
}

/** Zera o estado no logout para que a próxima sessão não herde o tenant anterior. */
export function resetWorkspaceState() {
  activeId = null
  writeStored(null)
  ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
}
