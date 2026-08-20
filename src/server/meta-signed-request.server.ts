/** Validação isolada do signed_request usado no callback de exclusão da Meta. */
import '@tanstack/react-start/server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const payloadSchema = z
  .object({
    algorithm: z.literal('HMAC-SHA256'),
    user_id: z.union([z.string(), z.number()]).transform(String),
    issued_at: z.number().int().positive().optional(),
  })
  .loose()

export function verifyMetaSignedRequest(value: string, appSecret: string) {
  if (value.length > 16_384) return null
  const [encodedSignature, encodedPayload, extra] = value.split('.')
  if (!encodedSignature || !encodedPayload || extra) return null
  let signature: Buffer
  let parsed: unknown
  try {
    signature = Buffer.from(encodedSignature, 'base64url')
    parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    )
  } catch {
    return null
  }
  const expected = createHmac('sha256', appSecret)
    .update(encodedPayload)
    .digest()
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  )
    return null
  const payload = payloadSchema.safeParse(parsed)
  if (!payload.success || payload.data.user_id.length > 200) return null
  if (
    payload.data.issued_at &&
    payload.data.issued_at * 1_000 > Date.now() + 5 * 60_000
  )
    return null
  return payload.data
}
