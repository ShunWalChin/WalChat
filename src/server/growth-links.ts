/**
 * Links de captação: `ig.me` com parâmetro de origem.
 *
 * É o caminho que a Meta abre para trazer gente de fora para dentro do direct —
 * e o mais próximo que existe, no API público, do que o Follow to DM faz por
 * parceria. Quem toca no link cai na conversa com você, a janela de 24h abre no
 * mesmo ato, e o webhook chega dizendo de onde a pessoa veio.
 *
 * Regras vêm da documentação da Meta e estão fixadas em teste:
 * - formato `https://ig.me/<usuario>?ref=<conteudo>`
 * - `ref` aceita até 2.083 caracteres, apenas alfanumérico, `-`, `_` e `=`
 * - o objeto de referral traz `{ ref, source: 'SHORTLINKS', type: 'OPEN_THREAD' }`
 *
 * Módulo puro: sem rede nem banco, para que a montagem e a leitura do link
 * sejam testáveis e sirvam também à tela.
 */
import { z } from 'zod'

/** Teto documentado pela Meta para o parâmetro de origem. */
export const MAX_REF_LENGTH = 2_083

/** A Meta aceita alfanumérico, hífen, sublinhado e igual. Nada além disso. */
const REF_PATTERN = /^[A-Za-z0-9_=-]+$/

export const growthLinkSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    /** Aparece na URL; é o que identifica a origem no webhook. */
    ref: z
      .string()
      .trim()
      .min(1)
      .max(MAX_REF_LENGTH)
      .regex(REF_PATTERN, 'Use apenas letras, números, hífen, _ e =.'),
    isActive: z.boolean().default(true),
    /** Fluxo próprio deste link; sem ele, cai na saudação geral. */
    flowId: z.uuid().nullable().optional(),
  })
  .strict()

export type GrowthLink = z.infer<typeof growthLinkSchema>

/**
 * Deriva um `ref` a partir do nome que o operador escreveu.
 *
 * Pedir o nome e o código separados obrigaria a pessoa a entender o mecanismo
 * para criar um link. O nome é o que ela pensa; o código é consequência.
 */
export function refFromName(name: string, taken: Array<string> = []) {
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'link'
  if (!taken.includes(base)) return base
  for (let sufixo = 2; sufixo < 100; sufixo++)
    if (!taken.includes(`${base}-${sufixo}`)) return `${base}-${sufixo}`
  return `${base}-${taken.length}`
}

/**
 * Monta a URL final.
 *
 * O usuário vai sem `@` de propósito: a Meta não aceita o arroba no caminho, e
 * colar o handle com ele é o erro mais fácil de cometer.
 */
export function buildGrowthUrl(username: string, ref: string) {
  const handle = username.trim().replace(/^@/, '')
  return `https://ig.me/${encodeURIComponent(handle)}?ref=${encodeURIComponent(ref)}`
}

/** Forma do referral que a Meta entrega, em qualquer um dos três webhooks. */
export type MetaReferral = {
  ref?: unknown
  source?: unknown
  type?: unknown
}

/**
 * Extrai a origem do evento bruto.
 *
 * A Meta entrega o referral em três lugares diferentes conforme a conversa seja
 * nova, iniciada por icebreaker ou já existente. Ler só um deles perderia parte
 * das visitas — e a atribuição silenciosamente erraria.
 */
export function extractReferral(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const evento = raw as {
    referral?: MetaReferral
    postback?: { referral?: MetaReferral }
    message?: { referral?: MetaReferral }
  }
  const candidatos = [
    evento.referral,
    evento.postback?.referral,
    evento.message?.referral,
  ]
  for (const candidato of candidatos) {
    const ref = candidato?.ref
    if (typeof ref === 'string' && ref && REF_PATTERN.test(ref)) return ref
  }
  return null
}

/**
 * Descrição curta para a tela, sem repetir a URL inteira.
 *
 * Links longos quebram o layout e não ajudam a reconhecer a origem; o que a
 * pessoa procura na lista é o código, não o domínio.
 */
export function describeGrowthLink(link: {
  name: string
  ref: string
  clicks?: number
}) {
  return {
    name: link.name,
    ref: link.ref,
    clicks: link.clicks ?? 0,
    hint: `?ref=${link.ref}`,
  }
}
