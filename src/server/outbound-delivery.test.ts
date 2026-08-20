/** Contrato de idempotência que protege DMs reais contra retry duplicado. */
import { describe, expect, it } from 'vitest'
import {
  OutboundDeliveryError,
  fingerprintOutboundDelivery,
  normalizeIdempotencyKey,
  resolveExistingDelivery,
} from './outbound-delivery.server'

const decision = {
  allowed: true,
  policy: 'standard_24h' as const,
  body: 'Oi! Tudo certo?',
  secondsLeft24h: 3_600,
}

describe('normalizeIdempotencyKey', () => {
  it('aceita uma chave opaca segura e rejeita valor ausente ou injetável', () => {
    expect(
      normalizeIdempotencyKey('manual:550e8400-e29b-41d4-a716-446655440000'),
    ).toBe('manual:550e8400-e29b-41d4-a716-446655440000')
    expect(() => normalizeIdempotencyKey(null)).toThrow(OutboundDeliveryError)
    expect(() =>
      normalizeIdempotencyKey('chave com espaço\nsegunda-linha'),
    ).toThrow(OutboundDeliveryError)
  })
})

describe('fingerprintOutboundDelivery', () => {
  it('é estável para a mesma intenção e muda quando o destinatário muda', () => {
    const base = {
      workspaceId: 'workspace',
      instagramAccountId: 'account',
      recipientId: 'recipient-a',
      decision,
    }
    const first = fingerprintOutboundDelivery(base)
    const repeated = fingerprintOutboundDelivery(base)
    const different = fingerprintOutboundDelivery({
      ...base,
      recipientId: 'recipient-b',
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(repeated).toBe(first)
    expect(different).not.toBe(first)
    expect(first).not.toContain(decision.body)
  })
})

describe('resolveExistingDelivery', () => {
  const existing = {
    id: 'delivery',
    request_fingerprint: 'fingerprint',
    status: 'sent' as const,
    message_body: decision.body,
    policy_used: decision.policy,
    decision_reason: null,
    requested_tag: null,
    seconds_left_24h: decision.secondsLeft24h,
    provider_message_id: 'meta-message',
  }

  it('reproduz um sucesso salvo sem pedir novo envio', () => {
    expect(resolveExistingDelivery(existing, 'fingerprint')).toEqual({
      kind: 'replay',
      deliveryId: 'delivery',
      sent: true,
      providerMessageId: 'meta-message',
      decision,
    })
  })

  it('bloqueia reuso com payload diferente e estado ambíguo', () => {
    expect(() =>
      resolveExistingDelivery(existing, 'different-fingerprint'),
    ).toThrowError(/outra requisição/i)
    expect(() =>
      resolveExistingDelivery(
        { ...existing, status: 'unknown', provider_message_id: null },
        'fingerprint',
      ),
    ).toThrowError(/confirmação manual/i)
  })
})
