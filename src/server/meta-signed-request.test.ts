import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyMetaSignedRequest } from './meta-signed-request.server'

const secret = 'meta-app-secret-for-test'

function sign(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url')
  return `${signature}.${encoded}`
}

describe('Meta signed_request', () => {
  it('aceita HMAC-SHA256 válido e extrai user_id', () => {
    expect(
      verifyMetaSignedRequest(
        sign({ algorithm: 'HMAC-SHA256', user_id: 'ig-user-1' }),
        secret,
      ),
    ).toMatchObject({ user_id: 'ig-user-1' })
  })

  it('recusa algoritmo alternativo, assinatura adulterada e JSON inválido', () => {
    expect(
      verifyMetaSignedRequest(
        sign({ algorithm: 'HMAC-SHA1', user_id: 'ig-user-1' }),
        secret,
      ),
    ).toBeNull()
    const valid = sign({ algorithm: 'HMAC-SHA256', user_id: 'ig-user-1' })
    expect(verifyMetaSignedRequest(`A${valid.slice(1)}`, secret)).toBeNull()
    expect(verifyMetaSignedRequest('abc.def', secret)).toBeNull()
  })
})
