/** Readiness profunda para balanceador, Docker e monitoramento externo. */
import { createFileRoute } from '@tanstack/react-router'
import { checkRuntimeReadiness } from '../../server/runtime-health.server'

export const Route = createFileRoute('/api/ready')({
  server: {
    handlers: {
      GET: async () => {
        const readiness = await checkRuntimeReadiness()
        return Response.json(
          { ...readiness, timestamp: new Date().toISOString() },
          {
            status: readiness.ok ? 200 : 503,
            headers: { 'Cache-Control': 'no-store' },
          },
        )
      },
    },
  },
})
