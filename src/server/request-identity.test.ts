import { afterEach, describe, expect, it } from 'vitest'
import { requestIdentity } from './request-identity.server'

function requestWith(headers: Record<string, string>) {
  return new Request('https://wal-chat.test/api/public/bookings/demo', {
    headers,
  })
}

afterEach(() => {
  delete process.env.TRUSTED_CLIENT_IP_HEADER
})

describe('requestIdentity', () => {
  it('usa o X-Real-IP definido pelo proxy', () => {
    expect(requestIdentity(requestWith({ 'x-real-ip': '203.0.113.10' }))).toBe(
      '203.0.113.10',
    )
  })

  it('ignora headers de CDN não configurada para não criar balde novo por request', () => {
    const identity = requestIdentity(
      requestWith({
        'cf-connecting-ip': '198.51.100.1',
        'x-real-ip': '203.0.113.10',
      }),
    )
    expect(identity).toBe('203.0.113.10')
  })

  it('usa o último salto do X-Forwarded-For, não o valor enviado pelo cliente', () => {
    const identity = requestIdentity(
      requestWith({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.10' }),
    )
    expect(identity).toBe('203.0.113.10')
  })

  it('descarta X-Real-IP forjado que não é um IP válido', () => {
    const identity = requestIdentity(
      requestWith({
        'x-real-ip': 'balde-novo-a-cada-request',
        'x-forwarded-for': '9.9.9.9, 203.0.113.10',
      }),
    )
    expect(identity).toBe('203.0.113.10')
  })

  it('colapsa IPv4 mapeado em IPv6 e porta no mesmo balde', () => {
    expect(
      requestIdentity(requestWith({ 'x-real-ip': '::ffff:203.0.113.10' })),
    ).toBe('203.0.113.10')
    expect(
      requestIdentity(requestWith({ 'x-real-ip': '203.0.113.10:51234' })),
    ).toBe('203.0.113.10')
  })

  it('honra um header de CDN declarado explicitamente pelo operador', () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'cf-connecting-ip'
    const identity = requestIdentity(
      requestWith({
        'cf-connecting-ip': '198.51.100.1',
        'x-real-ip': '203.0.113.10',
      }),
    )
    expect(identity).toBe('198.51.100.1')
  })

  it('cai em um balde compartilhado quando nenhum header confiável existe', () => {
    expect(requestIdentity(requestWith({}))).toBe('unknown-client')
  })
})
