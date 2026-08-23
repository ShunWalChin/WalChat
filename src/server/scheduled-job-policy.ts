/** Regras puras do scheduler, separadas do processo contínuo para teste. */
import { OutboundDeliveryError } from './outbound-delivery.server'

export const IMPLEMENTED_SCHEDULED_JOB_KINDS = [
  'sequence_step',
  'automation_step',
] as const
export type ImplementedScheduledJobKind =
  (typeof IMPLEMENTED_SCHEDULED_JOB_KINDS)[number]

export class UnsupportedScheduledJobError extends Error {
  readonly terminal = true

  constructor(readonly kind: string) {
    super(`scheduled_job_kind_not_implemented:${kind}`)
    this.name = 'UnsupportedScheduledJobError'
  }
}

export function isTerminalScheduledJobError(error: unknown) {
  return (
    error instanceof UnsupportedScheduledJobError ||
    (error instanceof OutboundDeliveryError && error.terminal)
  )
}

export function privateReplyFailureStatus(error: unknown) {
  return error instanceof OutboundDeliveryError &&
    ['delivery_unknown', 'delivery_in_progress'].includes(error.code)
    ? ('unknown' as const)
    : ('failed' as const)
}

/** Nunca persiste resposta externa, token, recipient ou texto de mensagem. */
export function operationalErrorCode(error: unknown) {
  if (error instanceof OutboundDeliveryError) return error.code
  if (error instanceof UnsupportedScheduledJobError) return error.message
  if (error instanceof Error) return error.name.slice(0, 80)
  return 'unknown_error'
}
