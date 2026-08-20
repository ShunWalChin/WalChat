/** Limites de fornecedor evitam requests presos e tempestade de retries. */
import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_MAX_RETRIES, AI_PROVIDER_TIMEOUT_MS } from './ai.server'

describe('AI provider runtime policy', () => {
  it('limita uma sugestão interativa a um retry e menos que o proxy HTTP', () => {
    expect(AI_PROVIDER_MAX_RETRIES).toBe(1)
    expect(AI_PROVIDER_TIMEOUT_MS).toBe(45_000)
    expect(AI_PROVIDER_TIMEOUT_MS).toBeLessThan(120_000)
  })
})
