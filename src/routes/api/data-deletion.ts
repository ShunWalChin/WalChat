/** Callback de signed request exigido pelo fluxo de Exclusão de Dados da Meta. */
import { createFileRoute } from '@tanstack/react-router'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getServerEnv } from '../../server/env.server'

/** Converte o base64url usado pela Meta para um Buffer padrão. */
function decodePart(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export const Route = createFileRoute('/api/data-deletion')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData()
        const signedRequest = String(form.get('signed_request') ?? '')
        const [encodedSignature, payloadPart] = signedRequest.split('.', 2)
        const env = getServerEnv()
        if (!encodedSignature || !payloadPart || !env.META_APP_SECRET)
          return Response.json(
            { error: 'Solicitação inválida.' },
            { status: 400 },
          )
        // O payload só é decodificado depois da assinatura constant-time ser aprovada.
        const expected = createHmac('sha256', env.META_APP_SECRET)
          .update(payloadPart)
          .digest()
        const received = decodePart(encodedSignature)
        if (
          expected.length !== received.length ||
          !timingSafeEqual(expected, received)
        )
          return Response.json(
            { error: 'Assinatura inválida.' },
            { status: 401 },
          )
        const payload = JSON.parse(
          decodePart(payloadPart).toString('utf8'),
        ) as { user_id?: string }
        const code = createHmac('sha256', env.META_APP_SECRET)
          .update(payload.user_id ?? 'unknown')
          .digest('hex')
          .slice(0, 20)
        return Response.json({
          url: `${env.APP_ORIGIN}/exclusao-de-dados?confirmation=${code}`,
          confirmation_code: code,
        })
      },
    },
  },
})
