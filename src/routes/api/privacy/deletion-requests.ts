/** Solicitação LGPD pública com rate limit, honeypot e trilha verificável. */
import { randomBytes } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
} from '../../../server/api-auth.server'
import { assertRateLimit } from '../../../server/rate-limit.server'
import { readJsonBody } from '../../../server/request-body.server'
import { requestIdentity } from '../../../server/request-identity.server'
import { getSupabaseAdmin } from '../../../server/supabase-admin.server'

const requestSchema = z.object({
  email: z.email().max(254),
  instagramUsername: z.string().trim().max(80).nullable().optional(),
  reason: z.string().trim().max(1_000).nullable().optional(),
  website: z.string().max(0).optional(),
})

const confirmationSchema = z.string().regex(/^[A-Za-z0-9_-]{24,128}$/)

export const Route = createFileRoute('/api/privacy/deletion-requests')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const confirmation = confirmationSchema.parse(
            new URL(request.url).searchParams.get('confirmation'),
          )
          const admin = getSupabaseAdmin()
          if (!admin) throw new ApiError(503, 'Serviço indisponível.')
          const { data, error } = await admin
            .from('privacy_deletion_requests')
            .select('status,requested_at,verified_at,completed_at')
            .eq('confirmation_code', confirmation)
            .maybeSingle()
          if (error) throw error
          if (!data) throw new ApiError(404, 'Solicitação não encontrada.')
          return Response.json(data, {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar a solicitação.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          await assertRateLimit({
            namespace: 'privacy-deletion',
            identity: requestIdentity(request),
            limit: 5,
            windowSeconds: 60 * 60,
          })
          const input = requestSchema.parse(
            await readJsonBody(request, 16 * 1024),
          )
          if (input.website) throw new ApiError(400, 'Solicitação inválida.')
          const admin = getSupabaseAdmin()
          if (!admin) throw new ApiError(503, 'Serviço indisponível.')
          const confirmationCode = randomBytes(24).toString('base64url')
          const { error } = await admin
            .from('privacy_deletion_requests')
            .insert({
              requester_email: input.email.toLowerCase(),
              instagram_username:
                input.instagramUsername?.replace(/^@/, '').toLowerCase() ||
                null,
              reason: input.reason || null,
              confirmation_code: confirmationCode,
              source: 'public_form',
            })
          if (error) throw error
          return Response.json(
            {
              confirmationCode,
              status: 'pending_verification',
              responsePromise: 'Contato humano em até 2 dias úteis.',
            },
            { status: 201, headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao registrar a solicitação.')
        }
      },
    },
  },
})
