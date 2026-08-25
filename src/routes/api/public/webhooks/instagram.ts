/** Endpoint público exigido pela Meta: challenge GET e recepção POST assinada. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { apiErrorResponse } from '../../../../server/api-auth.server'
import {
  getInstagramAppConfig,
  getServerEnv,
} from '../../../../server/env.server'
import { enqueueInstagramWebhook } from '../../../../server/queue.server'
import { assertRateLimit } from '../../../../server/rate-limit.server'
import { requestIdentity } from '../../../../server/request-identity.server'
import {
  INSTAGRAM_WEBHOOK_BODY_LIMIT,
  readLimitedText,
} from '../../../../server/request-body.server'
import { verifyMetaSignature } from '../../../../server/webhook-signature.server'

const webhookPayloadSchema = z
  .object({
    object: z.string().max(40),
    entry: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number()]).optional(),
            messaging: z
              .array(z.record(z.string(), z.unknown()))
              .max(200)
              .optional(),
            changes: z
              .array(z.record(z.string(), z.unknown()))
              .max(200)
              .optional(),
          })
          .loose(),
      )
      .max(100),
  })
  .loose()

export const Route = createFileRoute('/api/public/webhooks/instagram')({
  server: {
    handlers: {
      // A Meta espera o challenge como texto puro quando token e modo são válidos.
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const mode = url.searchParams.get('hub.mode')
        const token = url.searchParams.get('hub.verify_token')
        const challenge = url.searchParams.get('hub.challenge')
        const env = getServerEnv()
        const app = getInstagramAppConfig(env)
        if (
          mode === 'subscribe' &&
          challenge &&
          app.verifyToken &&
          token === app.verifyToken
        ) {
          return new Response(challenge, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-store',
            },
          })
        }
        return Response.json(
          { error: 'Verificação do webhook recusada.' },
          { status: 403 },
        )
      },
      // O corpo precisa permanecer bruto até a validação HMAC; fazer JSON antes quebraria a assinatura.
      POST: async ({ request }) => {
        try {
          const rawBody = await readLimitedText(
            request,
            INSTAGRAM_WEBHOOK_BODY_LIMIT,
            'application/json',
          )
          const env = getServerEnv()
          const app = getInstagramAppConfig(env)
          if (!app.appSecret)
            return Response.json(
              { error: 'Webhook não configurado.' },
              { status: 503 },
            )
          const valid = verifyMetaSignature(
            rawBody,
            request.headers.get('x-hub-signature-256'),
            app.appSecret,
          )
          if (!valid) {
            // Bursts assinados da Meta seguem sem cota. Só quem falha o HMAC
            // entra no balde, então uma enxurrada forjada para de consumir CPU.
            await assertRateLimit({
              namespace: 'instagram-webhook-unsigned',
              identity: requestIdentity(request),
              limit: 20,
              windowSeconds: 300,
            })
            return Response.json(
              { error: 'Assinatura inválida.' },
              { status: 401 },
            )
          }

          const payload = webhookPayloadSchema.parse(JSON.parse(rawBody))
          if (payload.object !== 'instagram')
            return Response.json(
              { received: true, ignored: true },
              { status: 200 },
            )
          const queued = await enqueueInstagramWebhook(payload, rawBody)
          return Response.json(
            { received: true, queued: queued.id, backend: queued.backend },
            { status: 200, headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'instagram_webhook_enqueue_failed',
              error: error instanceof Error ? error.name : 'unknown_error',
            }),
          )
          if (error instanceof SyntaxError || error instanceof z.ZodError)
            return Response.json(
              { error: 'Payload de webhook inválido.' },
              { status: 400 },
            )
          const boundedError = apiErrorResponse(
            error,
            'Falha temporária ao enfileirar.',
          )
          if (boundedError.status < 500) return boundedError
          return Response.json(
            { error: 'Falha temporária ao enfileirar.' },
            { status: 503, headers: { 'Retry-After': '10' } },
          )
        }
      },
    },
  },
})
