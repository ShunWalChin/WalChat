/** Correspondência de palavras preservando alfabetos não latinos. */

export type KeywordMatchMode = 'exact' | 'contains' | 'whole_word'

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

/**
 * Casamento por palavra inteira, sobre tokens em vez de regex.
 *
 * A normalização já transformou pontuação e emoji em separador, então basta
 * procurar a sequência de tokens do termo dentro da sequência do texto. Isso
 * evita duas armadilhas de uma vez: `\b` do ASCII nunca dispara entre dois
 * caracteres não latinos, e termo vindo do usuário precisaria de escape se
 * virasse regex.
 */
function containsTokenSequence(
  textTokens: Array<string>,
  termTokens: Array<string>,
) {
  if (!termTokens.length || termTokens.length > textTokens.length) return false
  for (let start = 0; start <= textTokens.length - termTokens.length; start++) {
    let igual = true
    for (let offset = 0; offset < termTokens.length; offset++) {
      if (textTokens[start + offset] !== termTokens[offset]) {
        igual = false
        break
      }
    }
    if (igual) return true
  }
  return false
}

export function matchKeywordTerms(
  text: string,
  terms: Array<string>,
  mode: KeywordMatchMode,
) {
  const normalizedText = normalizeKeywordText(text)
  if (!normalizedText) return { matched: false, keyword: null as string | null }

  const textTokens = mode === 'whole_word' ? normalizedText.split(' ') : []

  for (const term of terms) {
    const normalizedTerm = normalizeKeywordText(term)
    if (!normalizedTerm) continue
    let matched: boolean
    if (mode === 'exact') {
      matched = normalizedText === normalizedTerm
    } else if (mode === 'whole_word') {
      matched = containsTokenSequence(textTokens, normalizedTerm.split(' '))
    } else {
      matched = normalizedText.includes(normalizedTerm)
    }
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
