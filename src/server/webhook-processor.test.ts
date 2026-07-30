/** Garante que eventos sociais não ampliem indevidamente a janela de mensageria. */
import { describe, expect, it } from 'vitest'
import { opensMessagingWindow } from './webhook-processor.server'

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
