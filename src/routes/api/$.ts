/** Fallback explícito: rotas de API desconhecidas nunca viram erro interno. */
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: async () =>
        Response.json(
          { error: 'api_route_not_found' },
          {
            status: 404,
            headers: { 'Cache-Control': 'no-store' },
          },
        ),
    },
  },
})
