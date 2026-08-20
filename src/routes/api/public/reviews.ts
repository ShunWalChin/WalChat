/** Avaliações públicas só saem após consentimento e publicação explícita. */
import { createFileRoute } from '@tanstack/react-router'
import { apiErrorResponse } from '../../../server/api-auth.server'
import { getSupabaseAdmin } from '../../../server/supabase-admin.server'

export const Route = createFileRoute('/api/public/reviews')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const admin = getSupabaseAdmin()
          if (!admin) return Response.json({ reviews: [] })
          const { data, error } = await admin
            .from('customer_reviews')
            .select(
              'id,author_name,author_role,company,quote,rating,source_url,published_at',
            )
            .eq('is_verified', true)
            .not('consented_at', 'is', null)
            .not('published_at', 'is', null)
            .order('published_at', { ascending: false })
            .limit(6)
          if (error) {
            // Durante rollout sem migration, a landing continua disponível.
            if (error.code === '42P01') return Response.json({ reviews: [] })
            throw error
          }
          return Response.json(
            { reviews: data },
            { headers: { 'Cache-Control': 'public, max-age=300' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar avaliações.')
        }
      },
    },
  },
})
