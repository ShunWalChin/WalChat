/** Webhook público da WhatsApp Cloud API: challenge e POST com HMAC SHA-256. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { apiErrorResponse } from '../../../../server/api-auth.server'
import { getServerEnv } from '../../../../server/env.server'
import { enqueueWhatsAppWebhook } from '../../../../server/queue.server'
import {
  INSTAGRAM_WEBHOOK_BODY_LIMIT,
  readLimitedText,
} from '../../../../server/request-body.server'
import { verifyMetaSignature } from '../../../../server/webhook-signature.server'

const payloadSchema = z
  .object({
    object: z.string().max(60),
    entry: z.array(z.record(z.string(), z.unknown())).max(100),
  })
  .loose()

export const Route = createFileRoute('/api/public/webhooks/whatsapp')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const env = getServerEnv()
        if (
          url.searchParams.get('hub.mode') === 'subscribe' &&
          url.searchParams.get('hub.challenge') &&
          env.META_VERIFY_TOKEN &&
          url.searchParams.get('hub.verify_token') === env.META_VERIFY_TOKEN
        )
          return new Response(url.searchParams.get('hub.challenge'), {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-store',
            },
          })
        return Response.json(
          { error: 'Verificação do webhook recusada.' },
          { status: 403 },
        )
      },
      POST: async ({ request }) => {
        try {
          const rawBody = await readLimitedText(
            request,
            INSTAGRAM_WEBHOOK_BODY_LIMIT,
            'application/json',
          )
          const secret = getServerEnv().META_APP_SECRET
          if (!secret)
            return Response.json(
              { error: 'Webhook não configurado.' },
              { status: 503 },
            )
          if (
            !verifyMetaSignature(
              rawBody,
              request.headers.get('x-hub-signature-256'),
              secret,
            )
          )
            return Response.json(
              { error: 'Assinatura inválida.' },
              { status: 401 },
            )
          const payload = payloadSchema.parse(JSON.parse(rawBody))
          if (payload.object !== 'whatsapp_business_account')
            return Response.json({ received: true, ignored: true })
          const queued = await enqueueWhatsAppWebhook(payload, rawBody)
          return Response.json({ received: true, queued: queued.backend })
        } catch (error) {
          return apiErrorResponse(error, 'Payload de webhook inválido.')
        }
      },
    },
  },
})
