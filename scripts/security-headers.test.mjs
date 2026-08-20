import { describe, expect, it } from 'vitest'
import { buildSecurityHeaders } from './security-headers.mjs'

describe('cabeçalhos HTTP de produção', () => {
  it('fecha recursos perigosos e habilita HSTS em HTTPS', () => {
    const headers = buildSecurityHeaders({
      isHttps: true,
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(headers['content-security-policy']).toContain("object-src 'none'")
    expect(headers['content-security-policy']).toContain(
      "connect-src 'self' https://project.supabase.co wss://project.supabase.co",
    )
    expect(headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    )
    expect(headers['strict-transport-security']).toContain('includeSubDomains')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['cross-origin-resource-policy']).toBe('same-origin')
  })

  it('só libera domínios de Analytics e Maps quando configurados', () => {
    const closed = buildSecurityHeaders({ isHttps: true })
    const enabled = buildSecurityHeaders({
      isHttps: true,
      analyticsEnabled: true,
      mapsEnabled: true,
    })

    expect(closed['content-security-policy']).not.toContain('googletagmanager')
    expect(enabled['content-security-policy']).toContain(
      'https://www.googletagmanager.com',
    )
    expect(enabled['content-security-policy']).toContain(
      'https://www.google.com',
    )
  })

  it('ignora URL inválida e não ativa HSTS em HTTP local', () => {
    const headers = buildSecurityHeaders({
      isHttps: false,
      supabaseUrl: 'javascript:alert(1)',
    })

    expect(headers['content-security-policy']).toContain("connect-src 'self'")
    expect(headers['content-security-policy']).not.toContain('javascript:')
    expect(headers).not.toHaveProperty('strict-transport-security')
  })
})
