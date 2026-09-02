import { describe, expect, it } from 'vitest'
import {
  buildGoogleClickConversion,
  buildMetaConversion,
  normalizeEmailForAds,
  normalizePhoneForAds,
  sha256Identifier,
} from './ad-conversions.server'
import { adConversionRuleSchema } from './ad-conversions-contract'
import { N8N_OUTBOUND_EVENT_TYPES } from './n8n-contract'

describe('ad conversions', () => {
  it('normalizes and hashes identifiers deterministically', () => {
    expect(normalizeEmailForAds('  USER@Example.COM ')).toBe('user@example.com')
    expect(normalizePhoneForAds('(38) 99999-0000')).toBe('+38999990000')
    expect(sha256Identifier('same')).toBe(sha256Identifier('same'))
    expect(sha256Identifier('same')).toHaveLength(64)
  })

  it('builds Google payload with one click id and no raw PII', () => {
    const payload = buildGoogleClickConversion({
      eventId: '7f9b8067-3288-4c9a-8dde-4a9b44f54161',
      eventTime: '2026-09-02T12:30:00.000Z',
      customerId: '1234567890',
      conversionActionId: '987654321',
      valueCents: 15990,
      currency: 'BRL',
      contact: { email: 'Lead@Example.com', phone: '+55 38 99999-0000' },
      attribution: {
        gclid: 'preferred-gclid',
        wbraid: 'ignored-wbraid',
      },
    })

    expect(payload).toMatchObject({
      gclid: 'preferred-gclid',
      conversionDateTime: '2026-09-02 12:30:00+00:00',
      conversionValue: 159.9,
      currencyCode: 'BRL',
      consent: { adUserData: 'GRANTED' },
    })
    expect(payload).not.toHaveProperty('wbraid')
    expect(JSON.stringify(payload)).not.toContain('Lead@Example.com')
    expect(JSON.stringify(payload)).not.toContain('99999-0000')
  })

  it('builds a deduplicated Meta server event with hashed identifiers', () => {
    const payload = buildMetaConversion({
      eventId: 'event-123',
      eventName: 'QualifiedLead',
      eventTime: '2026-09-02T12:30:00.000Z',
      actionSource: 'website',
      valueCents: 5000,
      currency: 'BRL',
      contactId: 'contact-123',
      contact: { email: 'lead@example.com', phone: '+5538999990000' },
      attribution: {
        fbclid: 'click-123',
        fbp: 'fb.1.browser',
        landing_url: 'https://wal.example/oferta',
      },
      clickTime: '2026-08-30T10:00:00.000Z',
    })

    expect(payload).toMatchObject({
      event_name: 'QualifiedLead',
      event_id: 'event-123',
      event_source_url: 'https://wal.example/oferta',
      custom_data: { value: 50, currency: 'BRL' },
    })
    expect(payload.user_data.fbc).toBe('fb.1.1788084000000.click-123')
    expect(JSON.stringify(payload)).not.toContain('lead@example.com')
  })

  it('requires provider-specific conversion identifiers', () => {
    const result = adConversionRuleSchema.safeParse({
      stageId: '8a8856c3-5274-48d2-855f-0fc61074a279',
      name: 'Qualificado',
      googleEnabled: true,
      metaEnabled: false,
    })

    expect(result.success).toBe(false)
  })

  it('exposes conversion.ready as an n8n subscription', () => {
    expect(N8N_OUTBOUND_EVENT_TYPES).toContain('conversion.ready')
  })
})
