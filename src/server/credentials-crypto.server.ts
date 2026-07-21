/** Criptografia autenticada dos tokens de integrações armazenados no Postgres. */
import '@tanstack/react-start/server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getServerEnv } from './env.server'

const VERSION = 'v1'
const IV_BYTES = 12

function getEncryptionKey() {
  const encoded = getServerEnv().CREDENTIALS_ENCRYPTION_KEY
  if (!encoded)
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY é obrigatória para armazenar credenciais.',
    )

  const base64 = Buffer.from(encoded, 'base64')
  if (base64.length === 32) return base64

  const hex = Buffer.from(encoded, 'hex')
  if (hex.length === 32) return hex

  throw new Error(
    'CREDENTIALS_ENCRYPTION_KEY deve conter exatamente 32 bytes em base64 ou hexadecimal.',
  )
}

/** Permite health/configuração validarem o formato sem tocar em um secret real. */
export function hasValidCredentialEncryptionKey() {
  try {
    getEncryptionKey()
    return true
  } catch {
    return false
  }
}

/** Retorna um envelope versionado `v1.iv.tag.ciphertext` usando AES-256-GCM. */
export function encryptCredential(value: string) {
  if (!value) throw new Error('Não é possível cifrar uma credencial vazia.')
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

/** Decifra o envelope e recusa versões/formato adulterados. */
export function decryptCredential(envelope: string) {
  const [version, ivPart, tagPart, encryptedPart] = envelope.split('.')
  if (version !== VERSION || !ivPart || !tagPart || !encryptedPart)
    throw new Error('Envelope de credencial inválido.')

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivPart, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
