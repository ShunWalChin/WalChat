import { describe, expect, it } from 'vitest'
import {
  attributionFromBrowser,
  normalizeAdAttribution,
} from './ad-attribution'

describe('ad attribution', () => {
  it('captures Google, Meta, UTMs and first-party Meta cookies', () => {
    const result = attributionFromBrowser(
      'https://wal.example/agendar/demo?gclid=google-click&fbclid=meta-click&utm_source=google&utm_campaign=lancamento',
      'https://google.com/',
      '_fbp=fb.1.10.browser; _fbc=fb.1.10.meta-click',
      'Browser Test',
    )

    expect(result).toMatchObject({
      gclid: 'google-click',
      fbclid: 'meta-click',
      fbp: 'fb.1.10.browser',
      fbc: 'fb.1.10.meta-click',
      utmSource: 'google',
      utmCampaign: 'lancamento',
      clientUserAgent: 'Browser Test',
    })
  })

  it('accepts snake_case from external forms and bounds untrusted values', () => {
    const result = normalizeAdAttribution({
      gclid: 'g'.repeat(800),
      utm_source: 'meta',
      ad_user_data_consent: 'granted',
    })

    expect(result.gclid).toHaveLength(512)
    expect(result.utmSource).toBe('meta')
    expect(result.adUserDataConsent).toBe('granted')
  })

  it('defaults invalid consent to unknown', () => {
    expect(
      normalizeAdAttribution({ adUserDataConsent: 'yes' }).adUserDataConsent,
    ).toBe('unknown')
  })

  it('normaliza referral CTWA e remove dados privados da URL de origem', () => {
    const result = normalizeAdAttribution({
      ctwa_clid: `ctwa-${'x'.repeat(600)}`,
      source_id: '120212345678901234',
      source_url:
        'https://user:secret@facebook.com/ad?email=lead@example.com#private',
      source_type: 'ad',
      headline: 'Oferta do anúncio',
      media_type: 'image',
      waba_id: '1234567890',
    })

    expect(result.ctwaClid).toHaveLength(512)
    expect(result.ctwaSourceId).toBe('120212345678901234')
    expect(result.ctwaSourceUrl).toBe('https://facebook.com/ad')
    expect(result.ctwaHeadline).toBe('Oferta do anúncio')
    expect(result.ctwaWabaId).toBe('1234567890')
  })

  it('strips credentials, fragments and unrelated query data from stored URLs', () => {
    const result = normalizeAdAttribution({
      landing_url:
        'https://user:password@wal.example/oferta?utm_source=google&email=lead@example.com#secret',
      referrer_url: 'https://search.example/results?q=private',
    })

    expect(result.landingUrl).toBe(
      'https://wal.example/oferta?utm_source=google',
    )
    expect(result.referrerUrl).toBe('https://search.example/results')
  })
})
