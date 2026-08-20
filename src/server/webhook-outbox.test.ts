/** Decisão determinística usada para reconciliar Postgres e BullMQ. */
import { describe, expect, it } from 'vitest'
import { reconciliationAction } from './webhook-outbox.server'

describe('reconciliationAction', () => {
  it('reenfileira somente quando o job desapareceu do Redis', () => {
    expect(reconciliationAction(null)).toBe('enqueue')
    expect(reconciliationAction('waiting')).toBe('none')
    expect(reconciliationAction('active')).toBe('none')
    expect(reconciliationAction('delayed')).toBe('none')
  })

  it('concilia estados terminais sem repetir processamento', () => {
    expect(reconciliationAction('completed')).toBe('mark_processed')
    expect(reconciliationAction('failed')).toBe('mark_failed')
  })
})
