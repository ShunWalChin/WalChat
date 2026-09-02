/** Correspondência de palavras preservando alfabetos não latinos. */

export type KeywordMatchMode = 'exact' | 'contains'

/**
 * Remove acentos somente de letras latinas.
 *
 * Remover todo `\p{M}` quebraria escrita árabe, devanágari, tailandesa e
 * japonesa. A marca combinante herda aqui o alfabeto do caractere-base.
 */
export function foldLatinDiacritics(value: string) {
  let result = ''
  let latinBase = false
  for (const character of value.normalize('NFD')) {
    if (/\p{M}/u.test(character)) {
      if (!latinBase) result += character
      continue
    }
    latinBase = /\p{Script=Latin}/u.test(character)
    result += character
  }
  return result.normalize('NFC')
}

/** Converte pontuação e emoji em separadores sem apagar letras Unicode. */
export function normalizeKeywordText(value: string) {
  return foldLatinDiacritics(value)
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchKeywordTerms(
  text: string,
  terms: Array<string>,
  mode: KeywordMatchMode,
) {
  const normalizedText = normalizeKeywordText(text)
  if (!normalizedText) return { matched: false, keyword: null as string | null }

  for (const term of terms) {
    const normalizedTerm = normalizeKeywordText(term)
    if (!normalizedTerm) continue
    const matched =
      mode === 'exact'
        ? normalizedText === normalizedTerm
        : normalizedText.includes(normalizedTerm)
    if (matched) return { matched: true, keyword: term }
  }
  return { matched: false, keyword: null as string | null }
}

/** Aceita o campo novo e mantém compatibilidade com gatilhos antigos. */
export function triggerKeywordTerms(trigger: {
  keyword?: string | null
  keywords?: Array<string> | null
}) {
  const candidates = trigger.keywords?.length
    ? trigger.keywords
    : trigger.keyword
      ? [trigger.keyword]
      : []
  return Array.from(
    new Set(candidates.map((item) => item.trim()).filter(Boolean)),
  )
}
