import { describe, expect, it } from 'vitest'
import {
  INSTAGRAM_PRIVATE_REPLY_LIMIT,
  InstagramPrivateReplyRateLimitError,
  privateReplyLimitDecision,
} from './rate-limit.server'

describe('private reply account limit', () => {
  it('mantém margem abaixo de 750 por hora', () => {
    expect(INSTAGRAM_PRIVATE_REPLY_LIMIT).toBe(700)
    expect(privateReplyLimitDecision(699)).toEqual({
      allowed: true,
      remaining: 1,
    })
    expect(privateReplyLimitDecision(700)).toEqual({
      allowed: false,
      remaining: 0,
    })
  })

  it('nunca agenda retry instantâneo', () => {
    expect(new InstagramPrivateReplyRateLimitError(0).retryAfterMs).toBe(1_000)
  })
})
