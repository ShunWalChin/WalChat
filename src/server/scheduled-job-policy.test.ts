import { describe, expect, it } from 'vitest'
import { OutboundDeliveryError } from './outbound-delivery.server'
import {
  UnsupportedScheduledJobError,
  isTerminalScheduledJobError,
  operationalErrorCode,
  privateReplyFailureStatus,
} from './scheduled-job-policy'

describe('scheduled job policy', () => {
  it('falha terminalmente para kind não implementado', () => {
    const error = new UnsupportedScheduledJobError('campaign_message')
    expect(isTerminalScheduledJobError(error)).toBe(true)
    expect(operationalErrorCode(error)).toBe(
      'scheduled_job_kind_not_implemented:campaign_message',
    )
  })

  it('preserva ambiguidade de private reply após timeout', () => {
    const unknown = new OutboundDeliveryError('delivery_unknown', 'ambíguo')
    const failed = new OutboundDeliveryError('delivery_failed', 'recusado')
    expect(privateReplyFailureStatus(unknown)).toBe('unknown')
    expect(privateReplyFailureStatus(failed)).toBe('failed')
  })
})
