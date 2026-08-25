import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_TEMPLATES,
  automationTemplate,
} from './automation-templates'
import { validateAutomationGraph } from '../server/automation-graph'
import { simulateAutomation } from '../server/automation-simulator'

const variaveis = {
  contact: { display_name: 'Ana' },
  custom: {},
  bot: {},
  context: {},
}

describe('biblioteca de jornadas prontas', () => {
  it('oferece ao menos quatro pontos de partida', () => {
    expect(AUTOMATION_TEMPLATES.length).toBeGreaterThanOrEqual(4)
  })

  it('não repete identificador', () => {
    const ids = AUTOMATION_TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(AUTOMATION_TEMPLATES.map((template) => [template.id, template]))(
    'o template %s é publicável como está',
    (_id, template) => {
      // Um template que nasce inválido é pior que nenhum template: o operador
      // clona, tenta publicar e recebe um erro que não foi ele quem causou.
      expect(() => validateAutomationGraph(template.graph)).not.toThrow()
    },
  )

  it.each(AUTOMATION_TEMPLATES.map((template) => [template.id, template]))(
    'o template %s não depende de nenhum ID do workspace',
    (_id, template) => {
      // Tag, agente, página de agenda e subfluxo só existem no workspace de
      // quem criou — referenciá-los quebraria o template em qualquer outro.
      for (const node of template.graph.nodes) {
        expect(node.type).not.toBe('subflow')
        expect(node.type).not.toBe('ai_reply')
        if (node.type === 'message')
          expect(node.config.bookingPageId ?? null).toBeNull()
        if (node.type === 'action')
          for (const action of node.config.actions)
            expect(['add_tag', 'remove_tag']).not.toContain(action.type)
      }
    },
  )

  it.each(AUTOMATION_TEMPLATES.map((template) => [template.id, template]))(
    'o template %s percorre até o fim quando o contato responde',
    (_id, template) => {
      // Respostas genéricas não casam com botão nenhum; o que importa aqui é
      // que a simulação não termine em erro de fluxo mal desenhado.
      const resultado = simulateAutomation({
        graph: template.graph,
        variables: variaveis,
      })
      expect(resultado.status).not.toBe('error')
      expect(resultado.status).not.toBe('step_limit')
    },
  )

  it('percorre a captura de lead até o fim com respostas válidas', () => {
    const resultado = simulateAutomation({
      graph: automationTemplate('captura-lead')!.graph,
      variables: variaveis,
      replies: ['Quero sim', 'ana@exemplo.com.br'],
    })
    expect(resultado.status).toBe('completed')
    expect(
      resultado.steps.some((step) => step.summary.includes('email_lead')),
    ).toBe(true)
  })

  it('separa o lead qualificado pelo orçamento informado', () => {
    const acima = simulateAutomation({
      graph: automationTemplate('qualificacao-orcamento')!.graph,
      variables: { ...variaveis, custom: { orcamento_informado: 5_000 } },
      replies: ['5000'],
    })
    expect(acima.steps.map((step) => step.nodeId)).toContain('chamaTime')

    const abaixo = simulateAutomation({
      graph: automationTemplate('qualificacao-orcamento')!.graph,
      variables: { ...variaveis, custom: { orcamento_informado: 500 } },
      replies: ['500'],
    })
    expect(abaixo.steps.map((step) => step.nodeId)).toContain('nutricao')
    expect(abaixo.steps.map((step) => step.nodeId)).not.toContain('chamaTime')
  })

  it('devolve nulo para um identificador que não existe', () => {
    expect(automationTemplate('inexistente')).toBeNull()
  })
})
