import { describe, expect, it, vi } from 'vitest'
import { validateAiProviderCredential } from './ai-provider-validation.server'

const openAiInput = {
  provider: 'openai' as const,
  model: 'gpt-5.6-sol',
  apiKey: 'sk-proj-12345678901234567890',
}

describe('validateAiProviderCredential', () => {
  it('consulta o modelo selecionado com a credencial OpenAI', async () => {
    const retrieveOpenAiModel = vi.fn(async () => undefined)

    await validateAiProviderCredential(openAiInput, { retrieveOpenAiModel })

    expect(retrieveOpenAiModel).toHaveBeenCalledWith(openAiInput)
  })

  it('transforma autenticação inválida em erro acionável', async () => {
    const retrieveOpenAiModel = vi.fn(async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 })
    })

    await expect(
      validateAiProviderCredential(openAiInput, { retrieveOpenAiModel }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'A API key da OpenAI é inválida ou foi revogada.',
    })
  })

  it('envia a chave Google em header, nunca na URL', async () => {
    const fetchGoogleModel = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{}'),
    )
    const input = {
      provider: 'google' as const,
      model: 'gemini-2.5-flash',
      apiKey: 'google-key-12345678901234567890',
    }

    await validateAiProviderCredential(input, { fetchGoogleModel })

    const [url, init] = fetchGoogleModel.mock.calls[0]
    expect(String(url)).not.toContain(input.apiKey)
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(input.apiKey)
  })

  it('rejeita modelo sem permissão antes do salvamento', async () => {
    const retrieveOpenAiModel = vi.fn(async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 })
    })

    await expect(
      validateAiProviderCredential(openAiInput, { retrieveOpenAiModel }),
    ).rejects.toMatchObject({
      status: 403,
      message: 'A API key não tem permissão para usar gpt-5.6-sol.',
    })
  })
})
