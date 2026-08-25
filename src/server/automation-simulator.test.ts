import { describe, expect, it } from 'vitest'
import { simulateAutomation } from './automation-simulator'
import type { AutomationGraph } from './automation-graph'

const variaveis = {
  contact: { display_name: 'Ana', lead_score: 80 },
  custom: {},
  bot: {},
  context: {},
}

/** Menu de duas opções seguido de uma pergunta de e-mail. */
const fluxo: AutomationGraph = {
  schemaVersion: 3,
  entryNodeId: 'start',
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'menu',
      type: 'message',
      config: {
        text: 'Oi {{contact.display_name}}, o que você quer?',
        choices: [
          { key: 'agendar', label: 'Agendar' },
          { key: 'preco', label: 'Ver preços' },
        ],
      },
    },
    {
      id: 'email',
      type: 'user_input',
      config: {
        prompt: 'Qual seu e-mail?',
        expects: 'email',
        save: { target: 'custom', fieldKey: 'email_lead' },
        maxAttempts: 2,
        timeoutSeconds: 86_400,
      },
    },
    { id: 'tabela', type: 'message', config: { text: 'Nossa tabela é...' } },
    { id: 'fim', type: 'end', config: { outcome: 'completed' } },
  ],
  edges: [
    { from: 'start', to: 'menu', branch: 'default' },
    { from: 'menu', to: 'email', branch: 'agendar' },
    { from: 'menu', to: 'tabela', branch: 'preco' },
    { from: 'email', to: 'fim', branch: 'default' },
    { from: 'tabela', to: 'fim', branch: 'default' },
  ],
}

describe('simulação de fluxo', () => {
  it('para no menu quando não há resposta simulada', () => {
    const resultado = simulateAutomation({ graph: fluxo, variables: variaveis })
    expect(resultado.status).toBe('awaiting_reply')
    expect(resultado.awaitingNodeId).toBe('menu')
    expect(resultado.steps.at(-1)?.choices).toHaveLength(2)
  })

  it('interpola as variáveis do contato na mensagem', () => {
    const resultado = simulateAutomation({ graph: fluxo, variables: variaveis })
    expect(resultado.steps.at(-1)?.outgoing).toContain('Oi Ana')
  })

  it('mostra o rodapé obrigatório de opt-out', () => {
    const resultado = simulateAutomation({ graph: fluxo, variables: variaveis })
    // O texto real que sai não é o que foi digitado; ver isso na simulação
    // evita a surpresa depois de publicar.
    expect(resultado.steps.at(-1)?.outgoing).toContain('Responda PARAR')
  })

  it('segue a saída do botão escolhido', () => {
    const resultado = simulateAutomation({
      graph: fluxo,
      variables: variaveis,
      replies: ['Ver preços'],
    })
    // O ramo de preços cai numa mensagem simples e a jornada encerra ali.
    expect(resultado.status).toBe('completed')
    expect(resultado.steps.map((step) => step.nodeId)).toContain('tabela')
    expect(resultado.steps.map((step) => step.nodeId)).not.toContain('email')
  })

  it('entende o contato que digitou o rótulo em vez de tocar no botão', () => {
    const resultado = simulateAutomation({
      graph: fluxo,
      variables: variaveis,
      replies: ['  ver PREÇOS '],
    })
    expect(resultado.steps.map((step) => step.nodeId)).toContain('tabela')
  })

  it('percorre até o fim quando todas as respostas são dadas', () => {
    const resultado = simulateAutomation({
      graph: fluxo,
      variables: variaveis,
      replies: ['Agendar', 'ana@exemplo.com.br'],
    })
    expect(resultado.status).toBe('completed')
    expect(resultado.steps.at(-1)?.nodeType).toBe('end')
    const passoEmail = resultado.steps.find((step) => step.nodeId === 'email')
    expect(passoEmail?.summary).toContain('ana@exemplo.com.br')
  })

  it('marca a resposta que não corresponde a nenhum botão e explica o efeito real', () => {
    const resultado = simulateAutomation({
      graph: fluxo,
      variables: variaveis,
      replies: ['quanto custa?'],
    })
    expect(resultado.status).toBe('awaiting_reply')
    expect(resultado.steps.at(-1)?.warning).toContain('Inbox')
  })

  it('encaminha a resposta inválida para a saída invalid', () => {
    const comInvalid: AutomationGraph = {
      ...fluxo,
      edges: [
        ...fluxo.edges,
        { from: 'email', to: 'tabela', branch: 'invalid' },
      ],
    }
    const resultado = simulateAutomation({
      graph: comInvalid,
      variables: variaveis,
      replies: ['Agendar', 'não tenho e-mail'],
    })
    expect(resultado.steps.map((step) => step.nodeId)).toContain('tabela')
    expect(
      resultado.steps.find((step) => step.nodeId === 'email')?.summary,
    ).toContain('invalid_email')
  })

  it('avisa quando a saída necessária não existe em vez de travar', () => {
    const semInvalid = simulateAutomation({
      graph: fluxo,
      variables: variaveis,
      replies: ['Agendar', 'não tenho e-mail'],
    })
    expect(semInvalid.status).toBe('error')
    expect(semInvalid.error).toContain('invalid')
  })

  it('nunca chama IA, n8n nem API externa', () => {
    const comEfeitos: AutomationGraph = {
      schemaVersion: 3,
      entryNodeId: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'req',
          type: 'external_request',
          config: {
            method: 'POST',
            url: 'https://api.exemplo.com/x?token=segredo',
            headers: [],
            responseMapping: [],
            timeoutMs: 8_000,
          },
        },
        { id: 'fim', type: 'end' },
      ],
      edges: [
        { from: 'start', to: 'req', branch: 'default' },
        { from: 'req', to: 'fim', branch: 'default' },
      ],
    }
    const resultado = simulateAutomation({
      graph: comEfeitos,
      variables: variaveis,
    })
    expect(resultado.status).toBe('completed')
    const passo = resultado.steps.find((step) => step.nodeId === 'req')
    expect(passo?.warning).toContain('não faz a chamada')
    // O resumo mostra só o host: o caminho e a query podem carregar segredo.
    expect(passo?.summary).toContain('api.exemplo.com')
    expect(passo?.summary).not.toContain('segredo')
  })

  it('conta as respostas que sobraram sem uso', () => {
    const resultado = simulateAutomation({
      graph: fluxo,
      variables: variaveis,
      replies: ['Ver preços', 'sobra', 'outra'],
    })
    expect(resultado.unusedReplies).toBe(2)
  })

  it('avalia condição com a lógica real do motor', () => {
    const comCondicao: AutomationGraph = {
      schemaVersion: 3,
      entryNodeId: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'quente',
          type: 'condition',
          config: {
            source: 'contact',
            field: 'lead_score',
            operator: 'greater_than',
            value: 70,
          },
        },
        { id: 'sim', type: 'message', config: { text: 'Lead quente' } },
        { id: 'nao', type: 'message', config: { text: 'Lead frio' } },
        { id: 'fim', type: 'end' },
      ],
      edges: [
        { from: 'start', to: 'quente', branch: 'default' },
        { from: 'quente', to: 'sim', branch: 'true' },
        { from: 'quente', to: 'nao', branch: 'false' },
        { from: 'sim', to: 'fim', branch: 'default' },
        { from: 'nao', to: 'fim', branch: 'default' },
      ],
    }
    const resultado = simulateAutomation({
      graph: comCondicao,
      variables: variaveis,
    })
    expect(resultado.steps.map((step) => step.nodeId)).toContain('sim')
    expect(resultado.steps.map((step) => step.nodeId)).not.toContain('nao')
  })
})
