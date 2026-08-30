/**
 * Icebreakers: as perguntas prontas que aparecem antes de a pessoa digitar.
 *
 * São o outro lado dos links de captação. O link traz alguém até a porta; o
 * icebreaker dá a ela uma frase para começar, em vez de uma caixa em branco.
 *
 * A escolha de desenho que amarra os dois: o `payload` do icebreaker carrega uma
 * origem no mesmo formato do `ref` de um link. Assim a atribuição, a contagem e
 * o roteamento para o fluxo certo são exatamente o mesmo código — um icebreaker
 * é só mais uma porta de entrada com procedência conhecida.
 *
 * Regras vindas da documentação da Meta e fixadas em teste:
 * - no máximo 4 perguntas
 * - a Meta dispara `messaging_postback` quando a pessoa toca numa
 * - não aparecem no Instagram para desktop
 */
import { z } from 'zod'

/** Teto documentado pela Meta. */
export const MAX_ICEBREAKERS = 4

/** Prefixo que identifica um payload emitido por este produto. */
const ICEBREAKER_PREFIX = 'wal:ice'

/** O mesmo alfabeto do `ref` de link, para as duas portas serem intercambiáveis. */
const REF_PATTERN = /^[A-Za-z0-9_=-]+$/

const icebreakerSchema = z
  .object({
    /**
     * O texto que a pessoa vê e toca. Curto de propósito: a Meta trunca e o
     * espaço na tela do direct é pequeno.
     */
    question: z.string().trim().min(2).max(80),
    /** Origem associada, no mesmo formato do `ref` de um link de captação. */
    ref: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(REF_PATTERN, 'Use apenas letras, números, hífen, _ e =.'),
  })
  .strict()

export const icebreakersSchema = z.array(icebreakerSchema).max(MAX_ICEBREAKERS)

export type Icebreaker = z.infer<typeof icebreakerSchema>

/** Monta o payload que a Meta devolve quando a pergunta é tocada. */
export function icebreakerPayload(ref: string) {
  return `${ICEBREAKER_PREFIX}:${ref}`
}

/**
 * Lê a origem de um payload de postback.
 *
 * Devolve `null` para qualquer coisa que não tenha saído daqui: o payload volta
 * do cliente e é dado externo como qualquer outro.
 */
export function refFromIcebreakerPayload(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  if (!payload.startsWith(`${ICEBREAKER_PREFIX}:`)) return null
  const ref = payload.slice(ICEBREAKER_PREFIX.length + 1)
  return ref && REF_PATTERN.test(ref) ? ref : null
}

/**
 * Constrói o corpo que a Graph API espera.
 *
 * O formato é aninhado — `ice_breakers` é uma lista de blocos, cada um com suas
 * `call_to_actions` — porque a Meta usa a mesma estrutura para variar as
 * perguntas por idioma. Como só publicamos um idioma, é sempre um bloco.
 */
export function buildIcebreakersPayload(icebreakers: Array<Icebreaker>) {
  return {
    platform: 'instagram',
    ice_breakers: [
      {
        call_to_actions: icebreakers.map((item) => ({
          question: item.question,
          payload: icebreakerPayload(item.ref),
        })),
      },
    ],
  }
}

/** Corpo do DELETE, que a Meta exige com o campo nomeado. */
export function buildIcebreakersDeletePayload() {
  return { platform: 'instagram', fields: ['ice_breakers'] }
}

/**
 * Traduz a resposta da Graph API de volta para a forma editável.
 *
 * A tela precisa reabrir o que publicou; sem esta volta, revisar as perguntas
 * exigiria reescrevê-las do zero.
 */
export function readIcebreakersPayload(payload: unknown): Array<Icebreaker> {
  if (!payload || typeof payload !== 'object') return []
  const dados = payload as {
    data?: Array<{
      ice_breakers?: Array<{
        call_to_actions?: Array<{ question?: unknown; payload?: unknown }>
      }>
    }>
  }
  const blocos = dados.data?.[0]?.ice_breakers ?? []
  const acoes = blocos.flatMap((bloco) => bloco.call_to_actions ?? [])
  return acoes.flatMap((acao) => {
    const ref = refFromIcebreakerPayload(acao.payload)
    return typeof acao.question === 'string' && ref
      ? [{ question: acao.question, ref }]
      : []
  })
}
