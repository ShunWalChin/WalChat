import { describe, expect, it } from 'vitest'
import {
  isWithinBusinessHours,
  selectRoutingCandidate,
} from './team-routing.server'

const candidates = [
  {
    userId: 'b',
    available: true,
    capacity: 5,
    openConversations: 3,
    lastAssignedAt: '2026-08-28T12:00:00.000Z',
  },
  {
    userId: 'a',
    available: true,
    capacity: 5,
    openConversations: 1,
    lastAssignedAt: '2026-08-28T13:00:00.000Z',
  },
  {
    userId: 'c',
    available: false,
    capacity: 10,
    openConversations: 0,
    lastAssignedAt: null,
  },
]

describe('roteamento da equipe', () => {
  it('escolhe a menor carga proporcional', () => {
    expect(selectRoutingCandidate(candidates, 'least_loaded', 20)?.userId).toBe(
      'a',
    )
  })

  it('faz rodízio pela atribuição mais antiga', () => {
    expect(selectRoutingCandidate(candidates, 'round_robin', 20)?.userId).toBe(
      'b',
    )
  })

  it('respeita capacidade e modo manual', () => {
    expect(selectRoutingCandidate(candidates, 'least_loaded', 1)).toBeNull()
    expect(selectRoutingCandidate(candidates, 'manual', 20)).toBeNull()
  })

  it('interpreta expediente no fuso configurado', () => {
    const hours = {
      timezone: 'America/Sao_Paulo',
      weekdays: [5],
      start: '08:00',
      end: '18:00',
    }
    expect(
      isWithinBusinessHours(hours, new Date('2026-08-28T15:00:00.000Z')),
    ).toBe(true)
    expect(
      isWithinBusinessHours(hours, new Date('2026-08-29T15:00:00.000Z')),
    ).toBe(false)
  })
})
