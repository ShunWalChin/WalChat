import { describe, expect, it } from 'vitest'
import { evaluateWorkerHeartbeat } from './check-worker-health.mjs'

const now = Date.parse('2026-07-30T20:05:00.000Z')

describe('evaluateWorkerHeartbeat', () => {
  it('aceita heartbeat recente e saudável do serviço esperado', () => {
    expect(
      evaluateWorkerHeartbeat(
        {
          service: 'scheduler',
          status: 'healthy',
          checkedAt: '2026-07-30T20:04:30.000Z',
        },
        { service: 'scheduler', maxAgeSeconds: 60, now },
      ),
    ).toEqual({ ok: true, reason: 'healthy' })
  })

  it('rejeita heartbeat degradado, trocado ou expirado', () => {
    expect(
      evaluateWorkerHeartbeat(
        {
          service: 'scheduler',
          status: 'unhealthy',
          checkedAt: '2026-07-30T20:04:30.000Z',
        },
        { service: 'scheduler', maxAgeSeconds: 60, now },
      ).reason,
    ).toBe('unhealthy')
    expect(
      evaluateWorkerHeartbeat(
        {
          service: 'webhooks',
          status: 'healthy',
          checkedAt: '2026-07-30T20:04:30.000Z',
        },
        { service: 'scheduler', maxAgeSeconds: 60, now },
      ).reason,
    ).toBe('unhealthy')
    expect(
      evaluateWorkerHeartbeat(
        {
          service: 'scheduler',
          status: 'healthy',
          checkedAt: '2026-07-30T20:00:00.000Z',
        },
        { service: 'scheduler', maxAgeSeconds: 60, now },
      ).reason,
    ).toBe('stale')
  })
})
