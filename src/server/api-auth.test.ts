import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError, assertTrustedOrigin } from './api-auth.server'
import { getBearerToken } from './supabase-admin.server'

const originalOrigin = process.env.APP_ORIGIN

beforeEach(() => {
  process.env.APP_ORIGIN = 'https://wal-chat.example'
})

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.APP_ORIGIN
  else process.env.APP_ORIGIN = originalOrigin
})

describe('API authentication boundary', () => {
  it('aceita o esquema Bearer sem depender de capitalização', () => {
    const request = new Request('https://wal-chat.example/api/test', {
      headers: { Authorization: 'bearer jwt-token' },
    })
    expect(getBearerToken(request)).toBe('jwt-token')
  })

  it('recusa origem e Sec-Fetch-Site cross-site', () => {
    const originAttack = new Request('https://wal-chat.example/api/test', {
      headers: { Origin: 'https://evil.example' },
    })
    const fetchAttack = new Request('https://wal-chat.example/api/test', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(() => assertTrustedOrigin(originAttack)).toThrow(ApiError)
    expect(() => assertTrustedOrigin(fetchAttack)).toThrow(ApiError)
  })
})
