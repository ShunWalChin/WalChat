import { describe, expect, it } from 'vitest'
import { aiSettingsSchema } from './ai-settings-contract'

const validSettings = {
  provider: 'openai' as const,
  model: 'gpt-5.6-sol',
  reasoningEffort: 'low' as const,
  responseVerbosity: 'low' as const,
  maxOutputTokens: 500,
  isEnabled: true,
}

describe('aiSettingsSchema', () => {
  it('remove espaços acidentais antes de persistir a API key', () => {
    const result = aiSettingsSchema.parse({
      ...validSettings,
      apiKey: '  sk-proj-12345678901234567890  ',
    })

    expect(result.apiKey).toBe('sk-proj-12345678901234567890')
  })

  it('rejeita uma API key aparentemente incompleta', () => {
    expect(() =>
      aiSettingsSchema.parse({ ...validSettings, apiKey: 'sk-curta' }),
    ).toThrow()
  })

  it('impede salvar e remover a chave na mesma operação', () => {
    expect(() =>
      aiSettingsSchema.parse({
        ...validSettings,
        apiKey: 'sk-proj-12345678901234567890',
        removeApiKey: true,
      }),
    ).toThrow()
  })
})
