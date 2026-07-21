/** Garante que somente o corpo original assinado com o segredo correto seja aceito. */
import { describe, expect, it } from 'vitest'
import {
  signMetaPayload,
  verifyMetaSignature,
} from './webhook-signature.server'

describe('Meta webhook signature', () => {
  it('aceita apenas a assinatura HMAC SHA-256 correta', () => {
    const body = '{"object":"instagram","entry":[]}'
    const signature = signMetaPayload(body, 'segredo-local')
    expect(verifyMetaSignature(body, signature, 'segredo-local')).toBe(true)
    expect(verifyMetaSignature(`${body} `, signature, 'segredo-local')).toBe(
      false,
    )
    expect(verifyMetaSignature(body, null, 'segredo-local')).toBe(false)
  })
})
