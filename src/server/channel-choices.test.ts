import { describe, expect, it } from 'vitest'
import {
  choicePayload,
  instagramQuickReplies,
  matchChoice,
  whatsappInteractive,
} from './channel-choices'

const escolhas = [
  { key: 'agendar', label: 'Quero agendar' },
  { key: 'preco', label: 'Ver preços' },
]

describe('identificação da escolha respondida', () => {
  it('usa o payload do botão quando ele vem', () => {
    expect(
      matchChoice(escolhas, { payload: choicePayload('no1', 'preco') }),
    ).toBe('preco')
  })

  it('aceita o contato que digitou o rótulo em vez de tocar no botão', () => {
    expect(matchChoice(escolhas, { text: 'quero agendar' })).toBe('agendar')
    expect(matchChoice(escolhas, { text: '  QUERO   AGENDAR ' })).toBe(
      'agendar',
    )
  })

  it('ignora caracteres invisíveis colados no meio da resposta', () => {
    expect(matchChoice(escolhas, { text: 'Ver\u200Bpreços' })).toBeNull()
    expect(matchChoice(escolhas, { text: 'Ver preços\u200B' })).toBe('preco')
  })

  it('aceita a chave devolvida como texto puro', () => {
    expect(matchChoice(escolhas, { text: 'preco' })).toBe('preco')
  })

  it('devolve nulo para resposta livre que não corresponde a nada', () => {
    expect(matchChoice(escolhas, { text: 'quanto custa o plano anual?' })).toBe(
      null,
    )
  })

  it('recusa payload de escolha que não existe mais no nó', () => {
    expect(
      matchChoice(escolhas, { payload: choicePayload('no1', 'removida') }),
    ).toBeNull()
  })

  it('ignora payload que não veio deste produto', () => {
    expect(matchChoice(escolhas, { payload: 'outro:sistema:agendar' })).toBe(
      null,
    )
  })

  it('não confunde resposta vazia com escolha', () => {
    expect(matchChoice(escolhas, { text: '   ' })).toBeNull()
    expect(matchChoice(escolhas, {})).toBeNull()
  })
})

describe('renderização por canal', () => {
  it('Instagram recebe quick replies com título dentro do limite', () => {
    const rendered = instagramQuickReplies('no1', [
      { key: 'a', label: 'Um rótulo bem comprido demais' },
    ])
    expect(rendered[0].content_type).toBe('text')
    expect(rendered[0].title.length).toBeLessThanOrEqual(20)
    expect(rendered[0].payload).toBe(choicePayload('no1', 'a'))
  })

  it('WhatsApp usa botões até três opções', () => {
    const rendered = whatsappInteractive('no1', 'Escolha', escolhas)
    expect(rendered.type).toBe('button')
    if (rendered.type !== 'button') throw new Error('forma inesperada')
    expect(rendered.action.buttons).toHaveLength(2)
    expect(rendered.action.buttons[0].reply.title).toBe('Quero agendar')
  })

  it('WhatsApp troca para lista a partir da quarta opção', () => {
    const quatro = [
      ...escolhas,
      { key: 'suporte', label: 'Suporte' },
      { key: 'outro', label: 'Outro assunto' },
    ]
    const rendered = whatsappInteractive('no1', 'Escolha', quatro)
    expect(rendered.type).toBe('list')
    if (rendered.type !== 'list') throw new Error('forma inesperada')
    expect(rendered.action.sections[0].rows).toHaveLength(4)
    expect(rendered.action.button).toBe('Escolher')
  })

  it('corta o corpo interativo no teto da Cloud API', () => {
    const rendered = whatsappInteractive('no1', 'x'.repeat(2_000), escolhas)
    expect(rendered.body.text.length).toBe(1_024)
  })

  it('mantém o ida e volta do payload consistente entre canais', () => {
    const ig = instagramQuickReplies('no9', escolhas)
    expect(matchChoice(escolhas, { payload: ig[1].payload })).toBe('preco')

    const wa = whatsappInteractive('no9', 'Escolha', escolhas)
    if (wa.type !== 'button') throw new Error('forma inesperada')
    expect(
      matchChoice(escolhas, { payload: wa.action.buttons[1].reply.id }),
    ).toBe('preco')
  })
})
