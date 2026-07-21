/** Pré-visualização HTTP do mesmo motor puro usado imediatamente antes do envio. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { evaluateCompliance } from '../../../server/compliance'

const bodySchema = z.object({
  lastInboundAt: z.string().datetime().nullable(),
  optedOutAt: z.string().datetime().nullable().optional(),
  isAutomated: z.boolean(),
  message: z.string().min(1).max(1_000),
  requestedTag: z.string().nullable().optional(),
  triggerLastFiredAt: z.string().datetime().nullable().optional(),
  instagramCommentId: z.string().nullable().optional(),
  commentAlreadyReplied: z.boolean().optional(),
  blocklist: z.array(z.string()).max(100).optional(),
})

export const Route = createFileRoute('/api/compliance/check')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(
          await request.json().catch(() => null),
        )
        if (!parsed.success)
          return Response.json(
            { error: 'Entrada inválida.', details: parsed.error.flatten() },
            { status: 400 },
          )
        return Response.json(evaluateCompliance(parsed.data), {
          headers: { 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
