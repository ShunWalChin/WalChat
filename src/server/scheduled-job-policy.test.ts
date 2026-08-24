import { describe, expect, it } from 'vitest'
import { OutboundDeliveryError } from './outbound-delivery.server'
import {
  IMPLEMENTED_SCHEDULED_JOB_KINDS,
  UnsupportedScheduledJobError,
  isTerminalScheduledJobError,
  operationalErrorCode,
  privateReplyFailureStatus,
} from './scheduled-job-policy'

describe('scheduled job policy', () => {
  it('mantém eventos de integração dentro do runtime implementado', () => {
    expect(IMPLEMENTED_SCHEDULED_JOB_KINDS).toContain('integration_event')
    expect(IMPLEMENTED_SCHEDULED_JOB_KINDS).toContain('campaign_message')
    expect(IMPLEMENTED_SCHEDULED_JOB_KINDS).toContain('content_publish')
    expect(IMPLEMENTED_SCHEDULED_JOB_KINDS).toContain('insights_sync')
  })

  it('falha terminalmente para kind não implementado', () => {
    const error = new UnsupportedScheduledJobError('legacy_unknown')
    expect(isTerminalScheduledJobError(error)).toBe(true)
    expect(operationalErrorCode(error)).toBe(
      'scheduled_job_kind_not_implemented:legacy_unknown',
    )
  })

  it('preserva ambiguidade de private reply após timeout', () => {
    const unknown = new OutboundDeliveryError('delivery_unknown', 'ambíguo')
    const failed = new OutboundDeliveryError('delivery_failed', 'recusado')
    expect(privateReplyFailureStatus(unknown)).toBe('unknown')
    expect(privateReplyFailureStatus(failed)).toBe('failed')
  })
})
