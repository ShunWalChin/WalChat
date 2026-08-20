/** Verifica confidencialidade, integridade e compatibilidade da chave de credenciais. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptCredential,
  encryptCredential,
} from './credentials-crypto.server'

const originalKey = process.env.CREDENTIALS_ENCRYPTION_KEY
const context = {
  workspaceId: 'workspace-a',
  provider: 'meta',
  credentialType: 'access_token',
  scopeKey: 'account-a',
}

describe('credential encryption', () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    )
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
    else process.env.CREDENTIALS_ENCRYPTION_KEY = originalKey
  })

  it('round-trips sem persistir o valor em claro', () => {
    const secret = 'IGQVJ-token-super-secreto'
    const envelope = encryptCredential(secret, context)
    expect(envelope).toMatch(/^v2\./)
    expect(envelope).not.toContain(secret)
    expect(decryptCredential(envelope, context)).toBe(secret)
  })

  it('recusa qualquer alteração no envelope autenticado', () => {
    const envelope = encryptCredential('sk-projeto-teste', context)
    const parts = envelope.split('.')
    const tag = parts[2] ?? ''
    parts[2] = `${tag.startsWith('A') ? 'B' : 'A'}${tag.slice(1)}`
    const tampered = parts.join('.')
    expect(() => decryptCredential(tampered, context)).toThrow()
  })

  it('recusa mover ciphertext entre tenants ou escopos', () => {
    const envelope = encryptCredential('token-contextual', context)
    expect(() =>
      decryptCredential(envelope, { ...context, workspaceId: 'workspace-b' }),
    ).toThrow()
  })
})
