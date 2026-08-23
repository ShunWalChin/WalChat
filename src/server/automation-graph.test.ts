import { describe, expect, it } from 'vitest'
import {
  AutomationGraphError,
  automationNextNode,
  evaluateAutomationCondition,
  isAutomationFieldValue,
  renderAutomationTemplate,
  selectAutomationBranch,
  validateAutomationGraph,
} from './automation-graph'

const validGraph = {
  schemaVersion: 1 as const,
  entryNodeId: 'start',
  nodes: [
    { id: 'start', type: 'start' as const },
    {
      id: 'score',
      type: 'condition' as const,
      config: {
        source: 'custom' as const,
        field: 'lead_score',
        operator: 'greater_than' as const,
        value: 70,
      },
    },
    {
      id: 'welcome',
      type: 'message' as const,
      config: { text: 'Oi {{contact.display_name}}' },
    },
    { id: 'endHigh', type: 'end' as const },
    { id: 'endLow', type: 'end' as const },
  ],
  edges: [
    { from: 'start', to: 'score', branch: 'default' },
    { from: 'score', to: 'welcome', branch: 'true' },
    { from: 'score', to: 'endLow', branch: 'false' },
    { from: 'welcome', to: 'endHigh', branch: 'default' },
  ],
}

describe('automation graph', () => {
  it('valida um DAG e resolve arestas por porta', () => {
    const graph = validateAutomationGraph(validGraph)
    expect(automationNextNode(graph, 'score', 'true')).toBe('welcome')
  })

  it('rejeita ciclos e nós inalcançáveis', () => {
    expect(() =>
      validateAutomationGraph({
        ...validGraph,
        edges: [
          ...validGraph.edges.slice(0, -1),
          { from: 'welcome', to: 'score', branch: 'default' },
        ],
      }),
    ).toThrowError(AutomationGraphError)

    expect(() =>
      validateAutomationGraph({
        ...validGraph,
        nodes: [...validGraph.nodes, { id: 'orphan', type: 'end' }],
      }),
    ).toThrow('unreachable_node:orphan')
  })

  it('exige portas completas em condições', () => {
    expect(() =>
      validateAutomationGraph({
        ...validGraph,
        edges: validGraph.edges.filter(
          (edge) => !(edge.from === 'score' && edge.branch === 'false'),
        ),
      }),
    ).toThrow('invalid_node_branches:score')
  })

  it('exige 100% no randomizador', () => {
    expect(() =>
      validateAutomationGraph({
        schemaVersion: 1,
        entryNodeId: 'start',
        nodes: [
          { id: 'start', type: 'start' },
          {
            id: 'split',
            type: 'random_split',
            config: {
              branches: [
                { key: 'a', weight: 40 },
                { key: 'b', weight: 40 },
              ],
            },
          },
          { id: 'a', type: 'end' },
          { id: 'b', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'split' },
          { from: 'split', to: 'a', branch: 'a' },
          { from: 'split', to: 'b', branch: 'b' },
        ],
      }),
    ).toThrow('random_weights_must_total_100:split')
  })

  it('avalia condições tipadas e a janela de 24h', () => {
    const variables = {
      contact: { last_inbound_at: '2026-08-22T10:00:00.000Z' },
      custom: { lead_score: 82, city: 'São Paulo' },
      bot: {},
      context: {},
    }
    expect(
      evaluateAutomationCondition(
        {
          source: 'custom',
          field: 'lead_score',
          operator: 'greater_than',
          value: 70,
        },
        variables,
      ),
    ).toBe(true)
    expect(
      evaluateAutomationCondition(
        {
          source: 'custom',
          field: 'city',
          operator: 'contains',
          value: 'paulo',
        },
        variables,
      ),
    ).toBe(true)
    expect(
      evaluateAutomationCondition(
        {
          source: 'contact',
          field: 'last_inbound_at',
          operator: 'in_24h_window',
        },
        variables,
        new Date('2026-08-23T09:59:59.000Z'),
      ),
    ).toBe(true)
  })

  it('mantém a divisão A/B determinística em retries', () => {
    const node = {
      id: 'split',
      type: 'random_split' as const,
      config: {
        branches: [
          { key: 'control', weight: 50 },
          { key: 'variant', weight: 50 },
        ],
      },
    }
    const first = selectAutomationBranch(node, 'execution-1:split')
    expect(selectAutomationBranch(node, 'execution-1:split')).toBe(first)
  })

  it('interpola apenas namespaces permitidos sem executar expressões', () => {
    expect(
      renderAutomationTemplate(
        'Oi {{ contact.display_name }}, score {{custom.score}} {{process.env.SECRET}}',
        {
          contact: { display_name: 'Ana' },
          custom: { score: 91 },
          bot: {},
          context: {},
        },
      ),
    ).toBe('Oi Ana, score 91 {{process.env.SECRET}}')
  })

  it('valida valores de campos com a mesma semântica do banco', () => {
    expect(isAutomationFieldValue('number', 42)).toBe(true)
    expect(isAutomationFieldValue('number', '42')).toBe(false)
    expect(isAutomationFieldValue('date', '2026-08-22')).toBe(true)
    expect(isAutomationFieldValue('date', '22/08/2026')).toBe(false)
    expect(isAutomationFieldValue('boolean', false)).toBe(true)
  })
})
