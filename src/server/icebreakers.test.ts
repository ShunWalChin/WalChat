import { describe, expect, it } from 'vitest'
import {
  MAX_ICEBREAKERS,
  buildIcebreakersDeletePayload,
  buildIcebreakersPayload,
  icebreakerPayload,
  icebreakersSchema,
  readIcebreakersPayload,
} from './icebreakers'

const perguntas = [
  { question: 'Como funciona?', ref: 'como-funciona' },
  { question: 'Quero um orçamento', ref: 'orcamento' },
]

describe('contrato das perguntas', () => {
  it('aceita até quatro, que é o teto da Meta', () => {
    const quatro = Array.from({ length: MAX_ICEBREAKERS }, (_, i) => ({
      question: `Pergunta ${i}`,
      ref: `p${i}`,
    }))
    expect(() => icebreakersSchema.parse(quatro)).not.toThrow()
    expect(() =>
      icebreakersSchema.parse([...quatro, { question: 'Extra', ref: 'x' }]),
    ).toThrow()
  })

  it('recusa origem com caractere que a Meta não aceita', () => {
    expect(() =>
      icebreakersSchema.parse([{ question: 'Oi', ref: 'com espaço' }]),
    ).toThrow()
  })

  it('recusa pergunta longa demais para a tela do direct', () => {
    expect(() =>
      icebreakersSchema.parse([{ question: 'x'.repeat(81), ref: 'a' }]),
    ).toThrow()
  })

  it('aceita lista vazia, que é como se desliga', () => {
    expect(() => icebreakersSchema.parse([])).not.toThrow()
  })
})

describe('corpo enviado à Graph API', () => {
  it('usa o formato aninhado que a Meta espera', () => {
    const corpo = buildIcebreakersPayload(perguntas)
    expect(corpo.platform).toBe('instagram')
    expect(corpo.ice_breakers).toHaveLength(1)
    expect(corpo.ice_breakers[0].call_to_actions).toHaveLength(2)
  })

  it('carrega a origem no payload de cada pergunta', () => {
    const corpo = buildIcebreakersPayload(perguntas)
    expect(corpo.ice_breakers[0].call_to_actions[0].payload).toBe(
      icebreakerPayload('como-funciona'),
    )
  })

  it('nomeia o campo no corpo do DELETE, como a Meta exige', () => {
    expect(buildIcebreakersDeletePayload()).toEqual({
      platform: 'instagram',
      fields: ['ice_breakers'],
    })
  })
})

describe('leitura de volta', () => {
  it('sobrevive à ida e volta', () => {
    const corpo = buildIcebreakersPayload(perguntas)
    // A Graph API devolve embrulhado em `data`.
    const devolta = readIcebreakersPayload({ data: [corpo] })
    expect(devolta).toEqual(perguntas)
  })

  it('ignora pergunta cujo payload não saiu daqui', () => {
    // O payload volta do cliente; tratar como dado externo.
    const devolta = readIcebreakersPayload({
      data: [
        {
          ice_breakers: [
            {
              call_to_actions: [
                { question: 'Nossa', payload: 'outro-sistema:x' },
                { question: 'Válida', payload: icebreakerPayload('ok') },
              ],
            },
          ],
        },
      ],
    })
    expect(devolta).toEqual([{ question: 'Válida', ref: 'ok' }])
  })

  it('devolve lista vazia para resposta inesperada', () => {
    expect(readIcebreakersPayload(null)).toEqual([])
    expect(readIcebreakersPayload({})).toEqual([])
    expect(readIcebreakersPayload({ data: [] })).toEqual([])
  })
})
