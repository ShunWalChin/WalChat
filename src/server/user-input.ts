/**
 * Validação e normalização das respostas coletadas pelo nó de pergunta.
 *
 * Puro de propósito: o motor, o simulador de fluxo e os testes usam exatamente
 * a mesma decisão sobre o que é uma resposta válida. O valor devolvido já sai
 * normalizado, porque guardar "  (11) 99999-8888 " e "5511999998888" no mesmo
 * campo tornaria qualquer condição ou exportação inútil depois.
 */
export type UserInputExpectation =
  'text' | 'email' | 'phone' | 'number' | 'date'

export type UserInputResult =
  | { valid: true; value: string | number }
  | { valid: false; reason: UserInputRejection }

export type UserInputRejection =
  | 'empty'
  | 'too_long'
  | 'invalid_email'
  | 'invalid_phone'
  | 'invalid_number'
  | 'invalid_date'

const MAX_ANSWER_CHARS = 1_000

/** Mensagens prontas em PT-BR para quem não configurou um texto próprio. */
export const USER_INPUT_REJECTION_MESSAGE: Record<UserInputRejection, string> =
  {
    empty: 'Não consegui ler sua resposta. Pode escrever de novo?',
    too_long: 'Sua resposta ficou longa demais. Pode resumir?',
    invalid_email: 'Esse e-mail não parece válido. Confere pra mim?',
    invalid_phone: 'Esse telefone não parece válido. Manda com DDD?',
    invalid_number: 'Preciso de um número. Pode mandar só o número?',
    invalid_date: 'Não entendi essa data. Use o formato DD/MM/AAAA.',
  }

// Deliberadamente permissivo: e-mail válido de verdade só se prova enviando.
// Recusar endereços legítimos por regex estrita custa mais que aceitar um
// endereço errado que o próprio contato digitou.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export function validateUserInput(
  raw: string | null | undefined,
  expects: UserInputExpectation,
): UserInputResult {
  const value = raw?.normalize('NFKC').replace(/\s+/g, ' ').trim() ?? ''
  if (!value) return { valid: false, reason: 'empty' }
  if (value.length > MAX_ANSWER_CHARS)
    return { valid: false, reason: 'too_long' }

  if (expects === 'text') return { valid: true, value }

  if (expects === 'email') {
    const email = value.toLowerCase()
    return EMAIL.test(email)
      ? { valid: true, value: email }
      : { valid: false, reason: 'invalid_email' }
  }

  if (expects === 'phone') {
    const digits = value.replace(/\D/g, '')
    // 10 a 15 dígitos cobre fixo com DDD, celular com nono dígito e formato
    // internacional com país. Abaixo disso é quase sempre erro de digitação.
    if (digits.length < 10 || digits.length > 15)
      return { valid: false, reason: 'invalid_phone' }
    return { valid: true, value: digits }
  }

  if (expects === 'number') {
    // Aceita o formato brasileiro: 1.234,56 vira 1234.56.
    const normalized = value.includes(',')
      ? value.replace(/\./g, '').replace(',', '.')
      : value
    const digitsOnly = normalized.replace(/[^\d.-]/g, '')
    // `Number('')` é 0, não NaN. Sem exigir ao menos um dígito, "muito caro"
    // viraria orçamento zero e ninguém perceberia.
    if (!/\d/.test(digitsOnly))
      return { valid: false, reason: 'invalid_number' }
    const parsed = Number(digitsOnly)
    return Number.isFinite(parsed)
      ? { valid: true, value: parsed }
      : { valid: false, reason: 'invalid_number' }
  }

  return parseDate(value)
}

/**
 * DD/MM/AAAA é o formato que o contato brasileiro escreve; ISO entra porque é
 * o que outros sistemas mandam. Guardar sempre em ISO evita ambiguidade a
 * jusante.
 */
function parseDate(value: string): UserInputResult {
  const brazilian = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(value)
  if (brazilian) {
    const [, day, month, year] = brazilian
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    return isRealDate(iso)
      ? { valid: true, value: iso }
      : { valid: false, reason: 'invalid_date' }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && isRealDate(value))
    return { valid: true, value }
  return { valid: false, reason: 'invalid_date' }
}

/**
 * `new Date('2026-02-31')` não lança — ele desliza para 3 de março. Comparar a
 * volta com a entrada é o que separa data real de data inventada.
 */
function isRealDate(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`)
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso
  )
}
