/** Primitivas HMAC usadas para autenticar o corpo bruto enviado pela Meta. */
import '@tanstack/react-start/server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Produz o valor completo esperado no header `X-Hub-Signature-256`. */
export function signMetaPayload(rawBody: string, secret: string) {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`
}

/**
 * Compara assinatura e valor esperado em tempo constante.
 * A checagem de tamanho vem antes porque `timingSafeEqual` exige buffers iguais.
 */
export function verifyMetaSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
) {
  if (!signature?.startsWith('sha256=')) return false
  const expected = Buffer.from(signMetaPayload(rawBody, secret), 'utf8')
  const received = Buffer.from(signature, 'utf8')
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}
