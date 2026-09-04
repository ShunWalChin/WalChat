import { describe, expect, it } from 'vitest'
import {
  operationalAlertFingerprint,
  shouldNotifyOperationalAlert,
} from './operations-alerts.server'
import type { OperationalSlo } from './operations-alerts.server'

const warning: OperationalSlo = {
  overall: 'warning',
  generatedAt: '2026-09-04T10:00:00.000Z',
  services: [
    {
      id: 'scheduler',
      status: 'warning',
      successRate: 90,
      failed: 1,
      backlog: 2,
      oldestMinutes: 3,
      p95LatencyMs: null,
    },
  ],
}

describe('alertas operacionais', () => {
  it('notifica incidente novo e suprime repetição recente', () => {
    expect(shouldNotifyOperationalAlert(warning, null, 1_000)).toBe(true)
    expect(
      shouldNotifyOperationalAlert(
        warning,
        {
          status: 'warning',
          fingerprint: operationalAlertFingerprint(warning),
          last_notified_at: new Date(500).toISOString(),
        },
        1_000,
      ),
    ).toBe(false)
  })

  it('notifica mudança de estado e recuperação', () => {
    const recovered = { ...warning, overall: 'pass' as const, services: [] }
    expect(
      shouldNotifyOperationalAlert(recovered, {
        status: 'warning',
        fingerprint: operationalAlertFingerprint(warning),
        last_notified_at: new Date().toISOString(),
      }),
    ).toBe(true)
  })
})
