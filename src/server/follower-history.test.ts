import { describe, expect, it } from 'vitest'
import { reconstructFollowerTotals } from './follower-history'

describe('follower history reconstruction', () => {
  it('ancora no total atual e caminha para trás pelos deltas', () => {
    expect(
      reconstructFollowerTotals(
        [
          { date: '2026-09-01', delta: 5 },
          { date: '2026-09-02', delta: -2 },
        ],
        103,
      ),
    ).toEqual([
      { date: '2026-09-01', followers: 105 },
      { date: '2026-09-02', followers: 103 },
    ])
  })

  it('ordena os pontos antes de reconstruir', () => {
    expect(
      reconstructFollowerTotals(
        [
          { date: '2026-09-02', delta: 2 },
          { date: '2026-09-01', delta: 3 },
        ],
        10,
      ).map((item) => item.date),
    ).toEqual(['2026-09-01', '2026-09-02'])
  })
})
