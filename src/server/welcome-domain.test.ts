import { describe, expect, it } from 'vitest'
import { validateAutomationGraph } from './automation-graph'
import {
  buildWelcomeGraph,
  isFirstContact,
  readWelcomeGraph,
  summarizeWelcome,
  welcomeSettingsSchema,
} from './welcome-domain'

const saudacao = welcomeSettingsSchema.parse({
  isActive: true,
  channels: ['dm'],
  messages: [
    { text: 'Oi! Que bom te ver por aqui.' },
    { text: 'Sou o assistente do canal.', delaySeconds: 60 },
    { text: 'Como posso ajudar?', delaySeconds: 120 },
  ],
})

describe('quem é primeiro contato', () => {
  it('reconhece quem nunca falou antes', () => {
    expect(
      isFirstContact({
        previousInboundCount: 0,
        channel: 'dm',
        enabledChannels: ['dm'],
      }),
    ).toBe(true)
  })

  it('não sauda de novo quem já tinha falado', () => {
    expect(
      isFirstContact({
        previousInboundCount: 1,
        channel: 'dm',
        enabledChannels: ['dm'],
      }),
    ).toBe(false)
  })

  it('respeita o canal escolhido', () => {
    // Quem só quer saudar no direto não deve saudar quem comentou.
    expect(
      isFirstContact({
        previousInboundCount: 0,
        channel: 'comment',
        enabledChannels: ['dm'],
      }),
    ).toBe(false)
    expect(
      isFirstContact({
        previousInboundCount: 0,
        channel: 'comment',
        enabledChannels: ['dm', 'comment'],
      }),
    ).toBe(true)
  })
})

describe('saudação virando fluxo', () => {
  it('gera um DAG publicável', () => {
    const graph = buildWelcomeGraph(saudacao)
    // A validação da publicação é a mesma: uma saudação que não publica seria
    // um recurso que promete e falha na hora de valer.
    expect(() => validateAutomationGraph(graph)).not.toThrow()
  })

  it('encadeia mensagem, espera, mensagem na ordem escrita', () => {
    const graph = buildWelcomeGraph(saudacao)
    const tipos = graph.nodes.map((node) => node.type)
    expect(tipos.filter((t) => t === 'message')).toHaveLength(3)
    expect(tipos.filter((t) => t === 'delay')).toHaveLength(2)
  })

  it('não cria bloco de espera para a primeira mensagem', () => {
    const graph = buildWelcomeGraph(
      welcomeSettingsSchema.parse({
        messages: [{ text: 'Oi', delaySeconds: 300 }],
      }),
    )
    // A primeira sai na hora: esperar antes de cumprimentar não faz sentido.
    expect(graph.nodes.some((node) => node.type === 'delay')).toBe(false)
  })

  it('não cria bloco de espera com zero segundos', () => {
    const graph = buildWelcomeGraph(
      welcomeSettingsSchema.parse({
        messages: [{ text: 'Oi' }, { text: 'Tudo bem?', delaySeconds: 0 }],
      }),
    )
    // O motor exige no mínimo 1s num delay; um bloco de zero seria inválido.
    expect(graph.nodes.some((node) => node.type === 'delay')).toBe(false)
    expect(() => validateAutomationGraph(graph)).not.toThrow()
  })

  it('sobrevive à ida e volta para edição', () => {
    const graph = buildWelcomeGraph(saudacao)
    const devolta = readWelcomeGraph(graph)
    expect(devolta).toHaveLength(3)
    expect(devolta[0].text).toBe('Oi! Que bom te ver por aqui.')
    expect(devolta[1].delaySeconds).toBe(60)
    expect(devolta[2].delaySeconds).toBe(120)
  })

  it('lê o grafo pela ordem das arestas, não pela do array', () => {
    const graph = buildWelcomeGraph(saudacao)
    // Embaralha os nós: a sequência precisa vir das conexões.
    const embaralhado = { ...graph, nodes: [...graph.nodes].reverse() }
    const devolta = readWelcomeGraph(embaralhado)
    expect(devolta.map((m) => m.text)).toEqual([
      'Oi! Que bom te ver por aqui.',
      'Sou o assistente do canal.',
      'Como posso ajudar?',
    ])
  })

  it('carrega a mídia quando há', () => {
    const comMidia = welcomeSettingsSchema.parse({
      messages: [
        { text: 'Olha isto', mediaUrl: 'https://cdn.exemplo.com/a.jpg' },
      ],
    })
    const graph = buildWelcomeGraph(comMidia)
    const no = graph.nodes.find((item) => item.type === 'message')
    if (no?.type !== 'message') throw new Error('nó inesperado')
    expect(no.config.mediaUrl).toBe('https://cdn.exemplo.com/a.jpg')
  })
})

describe('limites do contrato', () => {
  it('aceita no máximo quatro mensagens', () => {
    const cinco = {
      messages: Array.from({ length: 5 }, (_, i) => ({ text: `m${i}` })),
    }
    expect(() => welcomeSettingsSchema.parse(cinco)).toThrow()
    const quatro = {
      messages: Array.from({ length: 4 }, (_, i) => ({ text: `m${i}` })),
    }
    expect(() => welcomeSettingsSchema.parse(quatro)).not.toThrow()
  })

  it('exige ao menos uma mensagem', () => {
    expect(() => welcomeSettingsSchema.parse({ messages: [] })).toThrow()
  })

  it('recusa mídia sem HTTPS', () => {
    expect(() =>
      welcomeSettingsSchema.parse({
        messages: [{ text: 'x', mediaUrl: 'http://cdn.exemplo.com/a.jpg' }],
      }),
    ).toThrow()
  })

  it('exige ao menos um canal', () => {
    expect(() =>
      welcomeSettingsSchema.parse({ channels: [], messages: [{ text: 'x' }] }),
    ).toThrow()
  })
})

describe('resumo para a tela', () => {
  it('soma a espera sem contar a primeira mensagem', () => {
    const resumo = summarizeWelcome(saudacao)
    expect(resumo.messages).toBe(3)
    expect(resumo.totalDelaySeconds).toBe(180)
  })
})
