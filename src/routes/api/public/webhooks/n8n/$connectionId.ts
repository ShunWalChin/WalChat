/** Entrada pública n8n com HMAC, janela anti-replay e deduplicação persistente. */
import { createFileRoute } from '@tanstack/react-router'
import { ZodError } from 'zod'
import { ApiError } from '../../../../../server/api-auth.server'
import {
  acceptN8nInboundDelivery,
  getN8nConnectionById,
  processN8nInboundEvent,
  signingSecretForConnection,
  verifyN8nPayload,
} from '../../../../../server/n8n-integration.server'
import { assertRateLimit } from '../../../../../server/rate-limit.server'
import {
  DEFAULT_JSON_BODY_LIMIT,
  readLimitedText,
} from '../../../../../server/request-body.server'

export const Route = createFileRoute('/api/public/webhooks/n8n/$connectionId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const connection = await getN8nConnectionById(params.connectionId)
          if (!connection || connection.status !== 'connected')
            throw new ApiError(404, 'Webhook não encontrado.')
          const rawBody = await readLimitedText(
            request,
            DEFAULT_JSON_BODY_LIMIT,
            'application/json',
          )
          const secret = await signingSecretForConnection(connection)
          if (
            !verifyN8nPayload({
              rawBody,
              timestamp: request.headers.get('x-walchat-timestamp'),
              signature: request.headers.get('x-walchat-signature-256'),
              secret,
            })
          )
            throw new ApiError(401, 'Assinatura do webhook inválida.')
          await assertRateLimit({
            namespace: 'n8n-inbound',
            identity: connection.id,
            limit: 120,
            windowSeconds: 60,
          })
          const deliveryId = request.headers.get('x-walchat-delivery-id')
          if (!deliveryId || !/^[A-Za-z0-9._:-]{8,128}$/.test(deliveryId))
            throw new ApiError(400, 'Delivery ID ausente ou inválido.')
          const accepted = await acceptN8nInboundDelivery({
            connection,
            deliveryId,
            rawBody,
          })
          if (accepted.duplicate)
            return Response.json(
              { accepted: true, duplicate: true },
              { status: 202 },
            )
          const result = await processN8nInboundEvent({
            connection,
            deliveryId,
            event: accepted.event,
          })
          return Response.json({ accepted: true, duplicate: false, result })
        } catch (error) {
          if (error instanceof ApiError)
            return Response.json(
              { error: error.message },
              { status: error.status },
            )
          if (error instanceof ZodError || error instanceof SyntaxError)
            return Response.json(
              { error: 'Payload inválido.' },
              { status: 400 },
            )
          console.error(
            JSON.stringify({
              event: 'n8n_inbound_failed',
              error: error instanceof Error ? error.name : 'unknown_error',
            }),
          )
          return Response.json(
            { error: 'Falha ao processar o evento.' },
            { status: 500 },
          )
        }
      },
    },
  },
})
