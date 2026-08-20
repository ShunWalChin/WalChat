/**
 * Motor central de elegibilidade de mensageria.
 *
 * Este módulo não acessa rede nem banco: ele recebe um snapshot do contato e
 * produz uma decisão determinística que pode ser testada e auditada. Todo
 * sender automático deve passar por `evaluateCompliance` no momento do envio.
 */
export const OPT_OUT_FOOTER = 'Responda PARAR'
export const MAX_META_TEXT_CHARS = 1_000
export const STANDARD_WINDOW_MS = 24 * 60 * 60 * 1000
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000

export type SendPolicy =
  'standard_24h' | 'human_agent_7d' | 'private_reply_7d' | 'blocked'

export type ComplianceInput = {
  now?: Date
  lastInboundAt: Date | string | null
  optedOutAt?: Date | string | null
  isAutomated: boolean
  message: string
  requestedTag?: 'HUMAN_AGENT' | string | null
  triggerLastFiredAt?: Date | string | null
  cooldownMs?: number
  instagramCommentId?: string | null
  commentCreatedAt?: Date | string | null
  commentAlreadyReplied?: boolean
  blocklist?: string[]
}

export type ComplianceDecision = {
  allowed: boolean
  policy: SendPolicy
  body: string
  tag?: string
  reason?:
    | 'opted_out'
    | 'no_inbound_interaction'
    | 'outside_24h'
    | 'outside_7d'
    | 'human_agent_is_not_automation'
    | 'trigger_cooldown'
    | 'comment_already_replied'
    | 'outside_private_reply_window'
    | 'blocked_content'
    | 'invalid_interaction_time'
  secondsLeft24h: number
}

/** Uniformiza Unicode e remove caracteres invisíveis usados para burlar filtros. */
export function normalizeComplianceText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR')
}

export function isOptOutKeyword(value: string) {
  return normalizeComplianceText(value) === 'parar'
}

function asTime(value: Date | string | null | undefined) {
  if (!value) return null
  const milliseconds =
    value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(milliseconds) ? milliseconds : null
}

/** Acrescenta o opt-out obrigatório sem duplicá-lo em mensagens já preparadas. */
export function withOptOut(message: string) {
  const clean = message.trim()
  const footerAtEnd = new RegExp(
    `\\s*${OPT_OUT_FOOTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'i',
  )
  const base = clean.replace(footerAtEnd, '').trim()
  const suffix = `\n\n${OPT_OUT_FOOTER}`
  return `${base.slice(0, MAX_META_TEXT_CHARS - suffix.length).trimEnd()}${suffix}`
}

/**
 * Aplica a ordem de bloqueios do Wal Chat e devolve o corpo final da mensagem.
 * A ordem é intencional: opt-out e ausência de inbound têm precedência sobre
 * conteúdo, cooldown e janelas para que o motivo auditado seja consistente.
 */
export function evaluateCompliance(input: ComplianceInput): ComplianceDecision {
  const now = (input.now ?? new Date()).getTime()
  const lastInbound = asTime(input.lastInboundAt)
  const messageBody = input.isAutomated
    ? withOptOut(input.message)
    : input.message.trim()
  const elapsed =
    lastInbound === null ? Number.POSITIVE_INFINITY : now - lastInbound
  const secondsLeft24h = Math.max(
    0,
    Math.floor((STANDARD_WINDOW_MS - elapsed) / 1000),
  )
  // Centralizar a construção evita que um branch de bloqueio omita o corpo ou o relógio da janela.
  const deny = (
    reason: ComplianceDecision['reason'],
    policy: SendPolicy = 'blocked',
  ): ComplianceDecision => ({
    allowed: false,
    policy,
    body: messageBody,
    reason,
    secondsLeft24h,
  })

  if (input.optedOutAt) return deny('opted_out')
  if (lastInbound !== null && lastInbound > now + MAX_CLOCK_SKEW_MS)
    return deny('invalid_interaction_time')

  const normalized = normalizeComplianceText(messageBody)
  if (
    (input.blocklist ?? []).some((term) => {
      const normalizedTerm = normalizeComplianceText(term)
      return normalizedTerm.length > 0 && normalized.includes(normalizedTerm)
    })
  )
    return deny('blocked_content')

  if (input.instagramCommentId && input.commentAlreadyReplied)
    return deny('comment_already_replied')

  // Private Reply é uma permissão própria da Meta: uma mensagem por comentário,
  // em até sete dias, sem transformar o comentário em uma janela padrão de DM.
  if (input.instagramCommentId) {
    const commentTime = asTime(input.commentCreatedAt) ?? lastInbound
    if (!commentTime) return deny('no_inbound_interaction')
    if (commentTime > now + MAX_CLOCK_SKEW_MS)
      return deny('invalid_interaction_time')
    if (now - commentTime > HUMAN_AGENT_WINDOW_MS)
      return deny('outside_private_reply_window')
    return {
      allowed: true,
      policy: 'private_reply_7d',
      body: messageBody,
      secondsLeft24h,
    }
  }

  if (!lastInbound) return deny('no_inbound_interaction')

  const lastFired = asTime(input.triggerLastFiredAt)
  if (
    input.isAutomated &&
    lastFired &&
    now - lastFired < (input.cooldownMs ?? DEFAULT_COOLDOWN_MS)
  )
    return deny('trigger_cooldown')

  if (elapsed <= STANDARD_WINDOW_MS)
    return {
      allowed: true,
      policy: 'standard_24h',
      body: messageBody,
      secondsLeft24h,
    }

  if (input.requestedTag === 'HUMAN_AGENT') {
    if (input.isAutomated) return deny('human_agent_is_not_automation')
    if (elapsed <= HUMAN_AGENT_WINDOW_MS)
      return {
        allowed: true,
        policy: 'human_agent_7d',
        body: messageBody,
        tag: 'HUMAN_AGENT',
        secondsLeft24h: 0,
      }
    return deny('outside_7d')
  }

  return deny('outside_24h')
}
