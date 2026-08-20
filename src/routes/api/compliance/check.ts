/** Pré-visualização HTTP do mesmo motor puro usado imediatamente antes do envio. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { evaluateCompliance } from '../../../server/compliance'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { assertRateLimit } from '../../../server/rate-limit.server'
import { readJsonBody } from '../../../server/request-body.server'

const bodySchema = z.object({
  lastInboundAt: z.string().datetime().nullable(),
  optedOutAt: z.string().datetime().nullable().optional(),
  isAutomated: z.boolean(),
  message: z.string().min(1).max(1_000),
  requestedTag: z.string().nullable().optional(),
  triggerLastFiredAt: z.string().datetime().nullable().optional(),
  instagramCommentId: z.string().nullable().optional(),
  commentCreatedAt: z.string().datetime().nullable().optional(),
  commentAlreadyReplied: z.boolean().optional(),
  blocklist: z.array(z.string()).max(100).optional(),
})

export const Route = createFileRoute('/api/compliance/check')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request)
          await assertRateLimit({
            namespace: 'compliance-preview',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 120,
            windowSeconds: 60,
          })
          const parsed = bodySchema.safeParse(await readJsonBody(request))
          if (!parsed.success)
            throw new ApiError(400, 'Entrada de compliance inválida.')
          return Response.json(evaluateCompliance(parsed.data), {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao avaliar compliance.')
        }
      },
    },
  },
})
