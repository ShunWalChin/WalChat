import { describe, expect, it } from 'vitest'
import {
  boostedMediaOrigins,
  commentNeedsReconciliation,
  findNextReel,
  unreconciledCommentCandidates,
} from './instagram-comment-reconciler.server'

describe('comment reconciliation', () => {
  it('descobre a mídia do anúncio a partir do webhook', () => {
    const origins = boostedMediaOrigins(
      [
        {
          entry: [
            {
              changes: [
                {
                  field: 'comments',
                  value: {
                    media: { id: 'ad-1', original_media_id: 'post-1' },
                  },
                },
              ],
            },
          ],
        },
      ],
      ['post-1'],
    )
    expect([...origins]).toEqual([['ad-1', 'post-1']])
  })

  it('ignora comentário próprio ou já respondido pelo perfil', () => {
    const trigger = {
      id: 't',
      post_id: null,
      keyword: 'preco',
      keywords: ['preco'],
      match_mode: 'contains' as const,
      instagram_account_id: null,
      target_next_reel: false,
    }
    expect(
      commentNeedsReconciliation({
        comment: { id: '1', text: 'preço', from: { id: 'business' } },
        accountInstagramId: 'business',
        triggers: [trigger],
      }),
    ).toBe(false)
    expect(
      commentNeedsReconciliation({
        comment: {
          id: '2',
          text: 'preço',
          from: { id: 'lead' },
          replies: { data: [{ from: { id: 'business' } }] },
        },
        accountInstagramId: 'business',
        triggers: [trigger],
      }),
    ).toBe(false)
  })

  it('seleciona o primeiro Reel posterior à regra', () => {
    expect(
      findNextReel(
        [
          {
            id: 'old',
            media_product_type: 'REELS',
            timestamp: '2026-09-01T09:00:00Z',
          },
          {
            id: 'later',
            media_product_type: 'REELS',
            timestamp: '2026-09-01T12:00:00Z',
          },
          {
            id: 'first',
            media_product_type: 'REELS',
            timestamp: '2026-09-01T11:00:00Z',
          },
        ],
        '2026-09-01T10:00:00Z',
      )?.id,
    ).toBe('first')
  })

  it('não deixa comentário novo preso atrás de antigos já processados', () => {
    const processed = Array.from({ length: 30 }, (_, index) => ({
      id: `old-${index}`,
      timestamp: `2026-09-01T10:${String(index).padStart(2, '0')}:00Z`,
    }))
    expect(
      unreconciledCommentCandidates(
        [...processed, { id: 'new', timestamp: '2026-09-01T11:00:00Z' }],
        new Set(processed.map((comment) => comment.id)),
        30,
      ).map((comment) => comment.id),
    ).toEqual(['new'])
  })
})
