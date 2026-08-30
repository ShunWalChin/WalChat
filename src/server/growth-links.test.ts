import { describe, expect, it } from 'vitest'
import {
  MAX_REF_LENGTH,
  buildGrowthUrl,
  extractReferral,
  growthLinkSchema,
  refFromName,
} from './growth-links'

describe('montagem do link', () => {
  it('usa o formato que a Meta documenta', () => {
    expect(buildGrowthUrl('walfredonetto', 'bio')).toBe(
      'https://ig.me/walfredonetto?ref=bio',
    )
  })

  it('remove o arroba, que a Meta não aceita no caminho', () => {
    // Colar o handle com @ é o erro mais fácil de cometer.
    expect(buildGrowthUrl('@walfredonetto', 'bio')).toBe(
      'https://ig.me/walfredonetto?ref=bio',
    )
  })
})

describe('código de origem derivado do nome', () => {
  it('remove acentos e normaliza', () => {
    expect(refFromName('Link da bio')).toBe('link-da-bio')
    expect(refFromName('Promoção de Março')).toBe('promocao-de-marco')
  })

  it('desempata nomes repetidos', () => {
    expect(refFromName('Bio', ['bio'])).toBe('bio-2')
    expect(refFromName('Bio', ['bio', 'bio-2'])).toBe('bio-3')
  })

  it('não devolve código vazio', () => {
    expect(refFromName('!!!')).toBe('link')
  })

  it('gera código que o próprio contrato aceita', () => {
    const ref = refFromName('Campanha de Verão 2026!')
    expect(() =>
      growthLinkSchema.parse({ name: 'Campanha', ref }),
    ).not.toThrow()
  })
})

describe('contrato do parâmetro', () => {
  it('recusa caractere fora do que a Meta permite', () => {
    // A Meta aceita apenas alfanumérico, hífen, sublinhado e igual.
    for (const ruim of ['tem espaço', 'acentuação', 'barra/aqui', 'ponto.aqui'])
      expect(() =>
        growthLinkSchema.parse({ name: 'teste', ref: ruim }),
      ).toThrow()
  })

  it('aceita os caracteres permitidos', () => {
    expect(() =>
      growthLinkSchema.parse({ name: 'teste', ref: 'campanha_2026-abc=' }),
    ).not.toThrow()
  })

  it('respeita o teto de 2.083 caracteres', () => {
    expect(() =>
      growthLinkSchema.parse({
        name: 'teste',
        ref: 'a'.repeat(MAX_REF_LENGTH),
      }),
    ).not.toThrow()
    expect(() =>
      growthLinkSchema.parse({
        name: 'teste',
        ref: 'a'.repeat(MAX_REF_LENGTH + 1),
      }),
    ).toThrow()
  })
})

describe('leitura do referral que a Meta envia', () => {
  it('lê conversa nova iniciada por mensagem', () => {
    expect(
      extractReferral({
        message: { referral: { ref: 'bio', source: 'SHORTLINKS' } },
      }),
    ).toBe('bio')
  })

  it('lê conversa nova iniciada por icebreaker', () => {
    expect(
      extractReferral({
        postback: { referral: { ref: 'story', type: 'OPEN_THREAD' } },
      }),
    ).toBe('story')
  })

  it('lê conversa que já existia', () => {
    // Nesta forma o referral vem na raiz do evento, sem mensagem junto.
    expect(extractReferral({ referral: { ref: 'qrcode' } })).toBe('qrcode')
  })

  it('devolve nulo quando não há origem', () => {
    expect(extractReferral({ message: { text: 'oi' } })).toBeNull()
    expect(extractReferral(null)).toBeNull()
    expect(extractReferral('texto')).toBeNull()
  })

  it('recusa referral com caractere inesperado', () => {
    // O valor volta do cliente pela URL; tratar como dado externo.
    expect(extractReferral({ referral: { ref: '../etc/passwd' } })).toBeNull()
    expect(extractReferral({ referral: { ref: 123 } })).toBeNull()
  })
})
