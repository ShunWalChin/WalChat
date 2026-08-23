/** Callback e status de exclusão de dados exigidos pela Meta. */
import { randomBytes } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { apiErrorResponse } from '../../server/api-auth.server'
import { getMetaAppSecrets, getServerEnv } from '../../server/env.server'
import { verifyMetaSignedRequest } from '../../server/meta-signed-request.server'
import { readLimitedText } from '../../server/request-body.server'
import { getSupabaseAdmin } from '../../server/supabase-admin.server'

const confirmationSchema = z.string().regex(/^[A-Za-z0-9_-]{24,128}$/)

export const Route = createFileRoute('/api/data-deletion')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const confirmation = confirmationSchema.parse(
            new URL(request.url).searchParams.get('confirmation'),
          )
          const supabase = getSupabaseAdmin()
          if (!supabase)
            return Response.json(
              { error: 'Serviço indisponível.' },
              { status: 503 },
            )
          const { data, error } = await supabase
            .from('data_deletion_requests')
            .select(
              'status,affected_contacts,affected_accounts,requested_at,completed_at',
            )
            .eq('confirmation_code', confirmation)
            .maybeSingle()
          if (error) throw error
          if (!data)
            return Response.json(
              { error: 'Solicitação não encontrada.' },
              { status: 404 },
            )
          return Response.json(data, {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar a exclusão.')
        }
      },
      POST: async ({ request }) => {
        try {
          const env = getServerEnv()
          const appSecrets = getMetaAppSecrets(env)
          if (appSecrets.length === 0)
            return Response.json(
              { error: 'Meta não configurada.' },
              { status: 503 },
            )
          const rawBody = await readLimitedText(
            request,
            32 * 1024,
            'application/x-www-form-urlencoded',
          )
          const signedRequest = new URLSearchParams(rawBody).get(
            'signed_request',
          )
          const payload = signedRequest
            ? appSecrets
                .map((secret) => verifyMetaSignedRequest(signedRequest, secret))
                .find(Boolean)
            : null
          if (!payload)
            return Response.json(
              { error: 'signed_request inválido.' },
              { status: 400 },
            )
          const supabase = getSupabaseAdmin()
          if (!supabase)
            return Response.json(
              { error: 'Serviço indisponível.' },
              { status: 503 },
            )
          const confirmationCode = randomBytes(24).toString('base64url')
          const { error } = await supabase.rpc('process_meta_data_deletion', {
            external_user_id: payload.user_id,
            target_confirmation_code: confirmationCode,
          })
          if (error) throw error
          const statusUrl = new URL('/api/data-deletion', env.APP_ORIGIN)
          statusUrl.searchParams.set('confirmation', confirmationCode)
          return Response.json({
            url: statusUrl.toString(),
            confirmation_code: confirmationCode,
          })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao processar a exclusão de dados.',
          )
        }
      },
    },
  },
})
