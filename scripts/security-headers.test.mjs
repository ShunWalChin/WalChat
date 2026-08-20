import { describe, expect, it } from 'vitest'
import { buildSecurityHeaders } from './security-headers.mjs'

describe('buildSecurityHeaders', () => {
  it('restringe a página e libera somente o Supabase configurado no connect-src', () => {
    const headers = buildSecurityHeaders({
      isHttps: true,
      supabaseUrl: 'https://api.walchat.example/rest/v1?ignored=true',
    })

    expect(headers['content-security-policy']).toContain(
      "connect-src 'self' https://api.walchat.example wss://api.walchat.example",
    )
    expect(headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    )
    expect(headers['strict-transport-security']).toBe('max-age=31536000')
    expect(headers['x-content-type-options']).toBe('nosniff')
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
