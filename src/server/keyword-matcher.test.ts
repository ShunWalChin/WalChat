import { describe, expect, it } from 'vitest'
import {
  foldLatinDiacritics,
  matchKeywordTerms,
  normalizeKeywordText,
  triggerKeywordTerms,
} from './keyword-matcher'

describe('keyword matcher Unicode', () => {
  it.each(['PREÇO', 'preço!', 'PreCo'])('casa %s com preco', (text) => {
    expect(matchKeywordTerms(text, ['preco'], 'contains')).toEqual({
      matched: true,
      keyword: 'preco',
    })
  })

  it('preserva marcas relevantes fora do alfabeto latino', () => {
    expect(foldLatinDiacritics('किताब العربية ガード')).toBe(
      'किताब العربية ガード',
    )
  })

  it('mantém diferença entre modo exato e contém', () => {
    expect(matchKeywordTerms('quero o link', ['link'], 'exact').matched).toBe(
      false,
    )
    expect(
      matchKeywordTerms('quero o link', ['link'], 'contains').matched,
    ).toBe(true)
  })

  it('normaliza emoji e pontuação como espaço', () => {
    expect(normalizeKeywordText('🔥 Quero—PREÇO!!!')).toBe('quero preco')
  })

  it('deduplica termos e aceita o campo legado', () => {
    expect(triggerKeywordTerms({ keyword: ' link ', keywords: [] })).toEqual([
      'link',
    ])
    expect(
      triggerKeywordTerms({ keyword: 'legado', keywords: ['link', 'link'] }),
    ).toEqual(['link'])
  })
})

describe('modo palavra inteira', () => {
  it('não dispara em substring no meio de outra palavra', () => {
    for (const texto of ['depois eu vejo', 'boa noite', 'sou um herói']) {
      expect(
        matchKeywordTerms(texto, ['oi'], 'whole_word').matched,
        texto,
      ).toBe(false)
    }
    for (const texto of ['tudo verde', 'na conversa', 'chegou a primavera']) {
      expect(
        matchKeywordTerms(texto, ['ver'], 'whole_word').matched,
        texto,
      ).toBe(false)
    }
    expect(
      matchKeywordTerms('me chama no linkedin', ['link'], 'whole_word').matched,
    ).toBe(false)
  })

  it('casa a palavra isolada com pontuação, acento e emoji em volta', () => {
    for (const texto of ['oi!', 'Oi, tudo bem?', '🔥 oi 🔥', 'oi']) {
      expect(
        matchKeywordTerms(texto, ['oi'], 'whole_word').matched,
        texto,
      ).toBe(true)
    }
    expect(
      matchKeywordTerms('qual o PREÇO?', ['preco'], 'whole_word').matched,
    ).toBe(true)
  })

  it('casa termo de várias palavras só quando na ordem', () => {
    expect(
      matchKeywordTerms('quero o link agora', ['quero o link'], 'whole_word')
        .matched,
    ).toBe(true)
    expect(
      matchKeywordTerms('o link quero', ['quero o link'], 'whole_word').matched,
    ).toBe(false)
  })

  it('mantém o comportamento antigo dos outros dois modos', () => {
    expect(matchKeywordTerms('depois', ['oi'], 'contains').matched).toBe(true)
    expect(matchKeywordTerms('oi', ['oi'], 'exact').matched).toBe(true)
    expect(matchKeywordTerms('oi tudo bem', ['oi'], 'exact').matched).toBe(
      false,
    )
  })
})
