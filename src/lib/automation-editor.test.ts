import { describe, expect, it } from 'vitest'
import { choiceKeyFromLabel, reconcileEdges } from './automation-editor'
import { validateAutomationGraph } from '../server/automation-graph'
import type { AutomationGraph } from '../server/automation-graph'

function grafo(
  nodes: AutomationGraph['nodes'],
  edges: AutomationGraph['edges'],
): AutomationGraph {
  return { schemaVersion: 3, entryNodeId: 'start', nodes, edges }
}

const start = { id: 'start', type: 'start' as const }
const fim = { id: 'fim', type: 'end' as const }

describe('reconciliação de saídas', () => {
  it('cria a saída de cada botão adicionado à mensagem', () => {
    const menu = {
      id: 'menu',
      type: 'message' as const,
      config: {
        text: 'Escolha',
        choices: [
          { key: 'sim', label: 'Sim' },
          { key: 'nao', label: 'Não' },
        ],
      },
    }
    const resultado = reconcileEdges(
      grafo(
        [start, menu, fim],
        [{ from: 'start', to: 'menu', branch: 'default' }],
      ),
    )
    const saidas = resultado.edges
      .filter((edge) => edge.from === 'menu')
      .map((edge) => edge.branch)
      .sort()
    expect(saidas).toEqual(['nao', 'sim'])
    // O grafo resultante precisa ser publicável, não só parecer certo.
    expect(() => validateAutomationGraph(resultado)).not.toThrow()
  })

  it('remove a saída órfã quando um botão é renomeado', () => {
    const menu = {
      id: 'menu',
      type: 'message' as const,
      config: {
        text: 'Escolha',
        choices: [{ key: 'agendar', label: 'Agendar' }],
      },
    }
    const resultado = reconcileEdges(
      grafo(
        [start, menu, fim],
        [
          { from: 'start', to: 'menu', branch: 'default' },
          // Sobra da chave antiga, antes do rename.
          { from: 'menu', to: 'fim', branch: 'marcar' },
        ],
      ),
    )
    const saidas = resultado.edges
      .filter((edge) => edge.from === 'menu')
      .map((edge) => edge.branch)
    expect(saidas).toEqual(['agendar'])
  })

  it('preserva as saídas opcionais já desenhadas', () => {
    const pergunta = {
      id: 'pergunta',
      type: 'user_input' as const,
      config: {
        prompt: 'Seu e-mail?',
        expects: 'email' as const,
        save: { target: 'custom' as const, fieldKey: 'email_lead' },
        maxAttempts: 2,
        timeoutSeconds: 86_400,
      },
    }
    const resultado = reconcileEdges(
      grafo(
        [start, pergunta, fim],
        [
          { from: 'start', to: 'pergunta', branch: 'default' },
          { from: 'pergunta', to: 'fim', branch: 'default' },
          { from: 'pergunta', to: 'fim', branch: 'invalid' },
          { from: 'pergunta', to: 'fim', branch: 'timeout' },
        ],
      ),
    )
    const saidas = resultado.edges
      .filter((edge) => edge.from === 'pergunta')
      .map((edge) => edge.branch)
      .sort()
    expect(saidas).toEqual(['default', 'invalid', 'timeout'])
  })

  it('reaproveita o destino que o bloco já usava em vez de cair no encerramento', () => {
    const menu = {
      id: 'menu',
      type: 'message' as const,
      config: {
        text: 'Escolha',
        choices: [
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
        ],
      },
    }
    const meio = {
      id: 'meio',
      type: 'message' as const,
      config: { text: 'Oi' },
    }
    const resultado = reconcileEdges(
      grafo(
        [start, menu, meio, fim],
        [
          { from: 'start', to: 'menu', branch: 'default' },
          { from: 'menu', to: 'meio', branch: 'a' },
          { from: 'meio', to: 'fim', branch: 'default' },
        ],
      ),
    )
    const novaSaida = resultado.edges.find(
      (edge) => edge.from === 'menu' && edge.branch === 'b',
    )
    expect(novaSaida?.to).toBe('meio')
  })

  it('não mexe num grafo que já está correto', () => {
    const original = grafo(
      [start, fim],
      [{ from: 'start', to: 'fim', branch: 'default' }],
    )
    expect(reconcileEdges(original).edges).toEqual(original.edges)
  })
})

describe('chave derivada do rótulo do botão', () => {
  it('remove acentos e normaliza para o formato da chave', () => {
    expect(choiceKeyFromLabel('Quero agendar já!', [])).toBe('quero_agendar_ja')
    expect(choiceKeyFromLabel('Ver preços', [])).toBe('ver_precos')
  })

  it('garante início por letra, como o contrato exige', () => {
    expect(choiceKeyFromLabel('1ª opção', [])).toMatch(/^[a-z]/)
    expect(choiceKeyFromLabel('123', [])).toBe('op_123')
  })

  it('desempata rótulos repetidos', () => {
    expect(choiceKeyFromLabel('Sim', ['sim'])).toBe('sim_2')
    expect(choiceKeyFromLabel('Sim', ['sim', 'sim_2'])).toBe('sim_3')
  })

  it('não devolve chave vazia para rótulo só com símbolos', () => {
    expect(choiceKeyFromLabel('!!!', [])).toBe('opcao')
    expect(choiceKeyFromLabel('   ', [])).toBe('opcao')
  })

  it('respeita o teto de tamanho da chave', () => {
    expect(choiceKeyFromLabel('a'.repeat(60), []).length).toBeLessThanOrEqual(
      32,
    )
  })
})
