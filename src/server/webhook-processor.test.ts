/** Garante que eventos sociais não ampliem indevidamente a janela de mensageria. */
import { describe, expect, it } from 'vitest'
import {
  extractInstagramMediaIds,
  opensMessagingWindow,
} from './webhook-processor.server'

describe('Instagram messaging window sources', () => {
  it.each(['dm', 'story_reply', 'postback'])('%s abre a janela', (channel) => {
    expect(opensMessagingWindow(channel)).toBe(true)
  })

  it.each(['comment', 'mention', 'reaction'])(
    '%s não abre a janela',
    (channel) => {
      expect(opensMessagingWindow(channel)).toBe(false)
    },
  )
})

describe('Instagram media origin', () => {
  it('mantém o post orgânico e a cópia impulsionada', () => {
    expect(
      extractInstagramMediaIds({
        media: { id: 'ad-media', original_media_id: 'organic-media' },
      }),
    ).toEqual(['organic-media', 'ad-media'])
  })

  it('aceita o formato legado media_id', () => {
    expect(extractInstagramMediaIds({ media_id: 'media-1' })).toEqual([
      'media-1',
    ])
  })
})
