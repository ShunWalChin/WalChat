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
