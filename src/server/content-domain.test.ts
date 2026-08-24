import { describe, expect, it } from 'vitest'
import { contentDraftSchema } from './content-domain'

const accountId = '00000000-0000-4000-8000-000000000001'

describe('content domain', () => {
  it('aceita feed com uma imagem HTTPS', () => {
    expect(
      contentDraftSchema.parse({
        accountId,
        kind: 'feed',
        title: 'Post',
        media: [{ url: 'https://cdn.example.com/post.jpg', type: 'image' }],
      }).kind,
    ).toBe('feed')
  })

  it('rejeita mídia incompatível e URL sem HTTPS', () => {
    expect(() =>
      contentDraftSchema.parse({
        accountId,
        kind: 'story',
        title: 'Story',
        media: [{ url: 'http://cdn.example.com/post.jpg', type: 'image' }],
      }),
    ).toThrow()
  })
})
