import { describe, expect, it } from 'vitest'
import {
  AutomationGraphError,
  nodeAwaitsReply,
  nodePorts,
  validateAutomationGraph,
} from './automation-graph'

/** Monta um grafo mínimo em volta do nó em teste. */
function graphWith(
  node: Record<string, unknown>,
  branches: Array<string>,
  extraNodes: Array<Record<string, unknown>> = [],
) {
  return {
    schemaVersion: 3 as const,
    entryNodeId: 'start',
    nodes: [
      { id: 'start', type: 'start' as const },
      node,
      { id: 'fim', type: 'end' as const },
      ...extraNodes,
    ],
    edges: [
      { from: 'start', to: 'alvo', branch: 'default' },
      ...branches.map((branch) => ({ from: 'alvo', to: 'fim', branch })),
    ],
  }
}

const mensagemComEscolhas = {
  id: 'alvo',
  type: 'message' as const,
  config: {
    text: 'Quer agendar?',
    choices: [
      { key: 'sim', label: 'Quero agendar' },
      { key: 'nao', label: 'Agora não' },
    ],
  },
}

const perguntaEmail = {
  id: 'alvo',
  type: 'user_input' as const,
  config: {
    prompt: 'Qual seu e-mail?',
    expects: 'email' as const,
    save: { target: 'custom' as const, fieldKey: 'email_lead' },
  },
}

describe('mensagem com escolhas', () => {
  it('exige uma saída por escolha', () => {
    expect(() =>
      validateAutomationGraph(graphWith(mensagemComEscolhas, ['sim', 'nao'])),
    ).not.toThrow()
  })

  it('recusa o grafo quando falta a saída de uma escolha', () => {
    expect(() =>
      validateAutomationGraph(graphWith(mensagemComEscolhas, ['sim'])),
    ).toThrow(AutomationGraphError)
  })

  it('aceita a saída opcional de timeout', () => {
    expect(() =>
      validateAutomationGraph(
        graphWith(mensagemComEscolhas, ['sim', 'nao', 'timeout']),
      ),
    ).not.toThrow()
  })

  it('recusa saída que não corresponde a nenhuma escolha', () => {
    expect(() =>
      validateAutomationGraph(
        graphWith(mensagemComEscolhas, ['sim', 'nao', 'talvez']),
      ),
    ).toThrow(AutomationGraphError)
  })

  it('mensagem sem escolhas continua com saída única', () => {
    const semEscolhas = {
      id: 'alvo',
      type: 'message' as const,
      config: { text: 'Oi' },
    }
    expect(() =>
      validateAutomationGraph(graphWith(semEscolhas, ['default'])),
    ).not.toThrow()
    expect(() =>
      validateAutomationGraph(graphWith(semEscolhas, ['default', 'timeout'])),
    ).toThrow(AutomationGraphError)
  })

  it('recusa rótulo maior que o teto do canal mais restritivo', () => {
    const rotuloLongo = {
      id: 'alvo',
      type: 'message' as const,
      config: {
        text: 'Escolha',
        choices: [{ key: 'a', label: 'x'.repeat(21) }],
      },
    }
    expect(() =>
      validateAutomationGraph(graphWith(rotuloLongo, ['a'])),
    ).toThrow()
  })

  it('recusa timeout configurado sem escolhas para não prometer espera que não existe', () => {
    const semEscolhas = {
      id: 'alvo',
      type: 'message' as const,
      config: { text: 'Oi', awaitTimeoutSeconds: 3_600 },
    }
    expect(() =>
      validateAutomationGraph(graphWith(semEscolhas, ['default'])),
    ).toThrow()
  })
})

describe('nó de pergunta ao contato', () => {
  it('aceita apenas a saída obrigatória', () => {
    expect(() =>
      validateAutomationGraph(graphWith(perguntaEmail, ['default'])),
    ).not.toThrow()
  })

  it('aceita as saídas de resposta inválida e de timeout', () => {
    expect(() =>
      validateAutomationGraph(
        graphWith(perguntaEmail, ['default', 'invalid', 'timeout']),
      ),
    ).not.toThrow()
  })

  it('exige a saída de sucesso', () => {
    expect(() =>
      validateAutomationGraph(graphWith(perguntaEmail, ['invalid'])),
    ).toThrow(AutomationGraphError)
  })

  it('aplica os padrões de tentativas e prazo', () => {
    const graph = validateAutomationGraph(graphWith(perguntaEmail, ['default']))
    const node = graph.nodes.find((item) => item.id === 'alvo')
    if (node?.type !== 'user_input') throw new Error('nó inesperado')
    expect(node.config.maxAttempts).toBe(2)
    expect(node.config.timeoutSeconds).toBe(86_400)
  })
})

describe('nó de requisição externa', () => {
  const request = {
    id: 'alvo',
    type: 'external_request' as const,
    config: { method: 'POST' as const, url: 'https://api.exemplo.com/leads' },
  }

  it('aceita a saída de erro além da de sucesso', () => {
    expect(() =>
      validateAutomationGraph(graphWith(request, ['default', 'error'])),
    ).not.toThrow()
  })

  it('recusa destino sem HTTPS', () => {
    const inseguro = {
      ...request,
      config: { method: 'GET' as const, url: 'http://api.exemplo.com' },
    }
    expect(() =>
      validateAutomationGraph(graphWith(inseguro, ['default'])),
    ).toThrow()
  })

  it('recusa caminho de resposta que tenta alcançar o protótipo', () => {
    const proto = {
      ...request,
      config: {
        method: 'GET' as const,
        url: 'https://api.exemplo.com',
        responseMapping: [
          {
            path: '__proto__.polluted',
            save: { target: 'bot' as const, fieldKey: 'x' },
          },
        ],
      },
    }
    expect(() =>
      validateAutomationGraph(graphWith(proto, ['default'])),
    ).toThrow()
  })
})

describe('nodeAwaitsReply', () => {
  it('marca os nós que param a execução esperando o contato', () => {
    expect(nodeAwaitsReply(mensagemComEscolhas)).toBe(true)
    expect(nodeAwaitsReply(perguntaEmail as never)).toBe(true)
  })

  it('não marca mensagem simples nem delay', () => {
    expect(
      nodeAwaitsReply({
        id: 'a',
        type: 'message',
        config: { text: 'Oi' },
      }),
    ).toBe(false)
    expect(
      nodeAwaitsReply({ id: 'b', type: 'delay', config: { seconds: 60 } }),
    ).toBe(false)
  })
})

describe('nodePorts', () => {
  it('não dá saída alguma ao nó final', () => {
    const ports = nodePorts({ id: 'f', type: 'end' })
    expect(ports.required.size).toBe(0)
    expect(ports.allowed.size).toBe(0)
  })
})
