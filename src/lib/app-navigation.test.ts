import { describe, expect, it } from 'vitest'
import type { AppNavigationTool } from './app-navigation'
import {
  commandCenterGroups,
  navigationGroups,
  utilityNavigationItems,
} from './app-navigation'

const expectedRoutes = [
  '/agentes',
  '/auditoria',
  '/auto-like',
  '/boas-vindas',
  '/calendario',
  '/captacao',
  '/comment-to-dm',
  '/configuracoes',
  '/contatos',
  '/crm',
  '/dashboard',
  '/equipe',
  '/gatilhos',
  '/governanca',
  '/inbox',
  '/insights',
  '/integracoes',
  '/manual',
  '/operacoes',
  '/publicar',
  '/radar',
  '/reengajamento',
  '/respostas',
  '/sequencias',
  '/webhooks',
]

describe('catálogo de navegação do aplicativo', () => {
  it('mantém todos os destinos do produto em uma única central sem duplicatas', () => {
    const routes = commandCenterGroups
      .flatMap((group) => group.items.map((item) => item.to))
      .sort()

    expect(routes).toEqual(expectedRoutes)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('mantém o menu lateral e os atalhos utilitários sincronizados', () => {
    const sidebarRoutes = navigationGroups.flatMap((group) =>
      group.items.map((item) => item.to),
    )
    const utilityRoutes = utilityNavigationItems.map((item) => item.to)

    expect([...sidebarRoutes, ...utilityRoutes].sort()).toEqual(expectedRoutes)
  })

  it('oferece contexto pesquisável e ícone em toda ferramenta', () => {
    const tools: Array<AppNavigationTool> = []
    for (const group of commandCenterGroups) {
      for (const tool of group.items) tools.push(tool)
    }

    expect(tools).toHaveLength(25)
    expect(
      tools.every(
        (tool) =>
          tool.label.length > 0 &&
          tool.description.length > 0 &&
          tool.keywords.length > 0 &&
          typeof tool.icon === 'object',
      ),
    ).toBe(true)
  })
})
