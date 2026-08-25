/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WORKSPACES = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Beta',
    slug: 'beta',
    role: 'owner',
  },
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000002',
    name: 'Alfa',
    slug: 'alfa',
    role: 'admin',
  },
]

// O módulo guarda estado no escopo dele; cada teste precisa de uma instância nova.
async function freshModule() {
  vi.resetModules()
  return import('./active-workspace')
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('workspace ativo', () => {
  it('escolhe o primeiro da lista quando não há nada salvo', async () => {
    const mod = await freshModule()
    expect(mod.publishWorkspaces(WORKSPACES)).toBe(WORKSPACES[0].id)
  })

  it('mantém o workspace salvo quando ele ainda existe', async () => {
    window.localStorage.setItem('wal-chat-workspace', WORKSPACES[1].id)
    const mod = await freshModule()
    expect(mod.publishWorkspaces(WORKSPACES)).toBe(WORKSPACES[1].id)
  })

  it('descarta o workspace salvo que o usuário perdeu acesso', async () => {
    window.localStorage.setItem(
      'wal-chat-workspace',
      'cccccccc-0000-4000-8000-000000000003',
    )
    const mod = await freshModule()
    expect(mod.publishWorkspaces(WORKSPACES)).toBe(WORKSPACES[0].id)
  })

  it('fica nulo quando o usuário não pertence a nenhum workspace', async () => {
    const mod = await freshModule()
    expect(mod.publishWorkspaces([])).toBeNull()
  })

  it('libera as chamadas em espera ao publicar a lista', async () => {
    const mod = await freshModule()
    let liberado = false
    void mod.whenWorkspaceReady().then(() => {
      liberado = true
    })
    expect(liberado).toBe(false)
    mod.publishWorkspaces(WORKSPACES)
    await mod.whenWorkspaceReady()
    expect(liberado).toBe(true)
  })

  it('libera as chamadas também quando não há workspace a resolver', async () => {
    const mod = await freshModule()
    mod.releaseWorkspaceGate()
    await expect(mod.whenWorkspaceReady()).resolves.toBeUndefined()
  })

  it('limpa o tenant e volta a travar o portão no logout', async () => {
    const mod = await freshModule()
    mod.publishWorkspaces(WORKSPACES)
    expect(mod.getActiveWorkspaceId()).toBe(WORKSPACES[0].id)

    mod.resetWorkspaceState()
    expect(mod.getActiveWorkspaceId()).toBeNull()
    expect(window.localStorage.getItem('wal-chat-workspace')).toBeNull()

    // O portão precisa travar de novo: a próxima sessão não pode reaproveitar
    // a resolução da anterior e sair sem header.
    let liberado = false
    void mod.whenWorkspaceReady().then(() => {
      liberado = true
    })
    await Promise.resolve()
    expect(liberado).toBe(false)
  })
})

describe('portão com prazo', () => {
  it('libera as chamadas se a descoberta pendurar sem responder', async () => {
    vi.useFakeTimers()
    try {
      const mod = await freshModule()
      let liberado = false
      // Ninguém chama publishWorkspaces nem releaseWorkspaceGate: simula uma
      // requisição que ficou pendurada sem resposta e sem erro.
      void mod.whenWorkspaceReady(8_000).then(() => {
        liberado = true
      })
      await vi.advanceTimersByTimeAsync(7_000)
      expect(liberado).toBe(false)
      await vi.advanceTimersByTimeAsync(1_500)
      expect(liberado).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolve imediatamente quando a lista chega antes do prazo', async () => {
    const mod = await freshModule()
    mod.publishWorkspaces(WORKSPACES)
    await expect(mod.whenWorkspaceReady(50)).resolves.toBeUndefined()
  })
})
