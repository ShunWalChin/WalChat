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

  it('troca unsafe-inline pelo nonce quando ele é fornecido', () => {
    const headers = buildSecurityHeaders({
      isHttps: true,
      scriptNonce: 'abc123',
    })
    const csp = headers['content-security-policy']

    expect(csp).toContain("script-src 'self' 'nonce-abc123'")
    // A diretiva de script não pode manter unsafe-inline: navegadores que
    // entendem nonce ignorariam o keyword, mas os que não entendem voltariam a
    // aceitar qualquer script injetado.
    const scriptDirective = csp
      .split('; ')
      .find((directive) => directive.startsWith('script-src '))
    expect(scriptDirective).not.toContain("'unsafe-inline'")
  })

  it('mantém unsafe-inline quando não há nonce, para não quebrar o SSR', () => {
    const headers = buildSecurityHeaders({ isHttps: true })
    const scriptDirective = headers['content-security-policy']
      .split('; ')
      .find((directive) => directive.startsWith('script-src '))

    expect(scriptDirective).toContain("'unsafe-inline'")
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
