import { describe, expect, it } from 'vitest'
import { parseTags, positionBeforeLead } from './utils'
import type { Lead } from './types'

describe('utilitários do CRM', () => {
  it('normaliza tags duplicadas e limita a trinta', () => {
    expect(parseTags('vip, inbound, vip')).toEqual(['vip', 'inbound'])
    expect(
      parseTags(
        Array.from({ length: 35 }, (_, index) => `t${index}`).join(','),
      ),
    ).toHaveLength(30)
  })

  it('calcula uma posição intermediária sem colidir com o alvo', () => {
    const base = (id: string, position: number): Lead =>
      ({
        id,
        position,
        stageId: 'stage',
      }) as Lead
    const leads = [base('one', 1000), base('two', 2000)]
    expect(positionBeforeLead(leads, leads[1], 'moving')).toBe(1500)
    expect(positionBeforeLead(leads, leads[0], 'moving')).toBe(500)
  })
})
