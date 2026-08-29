/** Valida autenticação e acesso ao modelo antes de persistir uma credencial. */
import '@tanstack/react-start/server-only'
import OpenAI from 'openai'
import { ApiError } from './api-auth.server'
import { getServerEnv } from './env.server'

const PROVIDER_VALIDATION_TIMEOUT_MS = 12_000

type ProviderValidationInput = {
  provider: 'openai' | 'google'
  model: string
  apiKey: string
}

type ProviderValidationDependencies = {
  retrieveOpenAiModel?: (input: ProviderValidationInput) => Promise<void>
  fetchGoogleModel?: typeof fetch
}

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`Provider HTTP ${status}`)
  }
}

function statusFromError(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof error.status === 'number'
  )
    return error.status
  return null
}

function validationError(input: ProviderValidationInput, error: unknown) {
  if (error instanceof ApiError) return error
  const providerName = input.provider === 'openai' ? 'OpenAI' : 'Google Gemini'
  const status = statusFromError(error)
  if (status === 401)
    return new ApiError(
      401,
      `A API key da ${providerName} é inválida ou foi revogada.`,
    )
  if (status === 403)
    return new ApiError(
      403,
      `A API key não tem permissão para usar ${input.model}.`,
    )
  if (status === 404)
    return new ApiError(
      422,
      `O modelo ${input.model} não está disponível para esta credencial.`,
    )
  if (status === 400)
    return new ApiError(
      422,
      `A ${providerName} recusou a API key ou o modelo selecionado.`,
    )
  if (status === 429)
    return new ApiError(
      429,
      `A ${providerName} recusou a validação por limite de uso. Verifique cotas e faturamento.`,
    )
  if (
    error instanceof Error &&
    ['AbortError', 'TimeoutError'].includes(error.name)
  )
    return new ApiError(
      504,
      `Tempo esgotado ao validar a conexão com a ${providerName}.`,
    )
  return new ApiError(
    502,
    `Não foi possível validar a conexão com a ${providerName}. Tente novamente.`,
  )
}

async function retrieveOpenAiModel(input: ProviderValidationInput) {
  const env = getServerEnv()
  const client = new OpenAI({
    apiKey: input.apiKey,
    project: env.OPENAI_PROJECT,
    organization: env.OPENAI_ORGANIZATION,
    timeout: PROVIDER_VALIDATION_TIMEOUT_MS,
    maxRetries: 0,
  })
  await client.models.retrieve(input.model)
}

async function retrieveGoogleModel(
  input: ProviderValidationInput,
  request: typeof fetch,
) {
  const response = await request(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}`,
    {
      headers: { 'x-goog-api-key': input.apiKey },
      signal: AbortSignal.timeout(PROVIDER_VALIDATION_TIMEOUT_MS),
    },
  )
  if (!response.ok) throw new ProviderHttpError(response.status)
}

export async function validateAiProviderCredential(
  input: ProviderValidationInput,
  dependencies: ProviderValidationDependencies = {},
) {
  try {
    if (input.provider === 'openai')
      await (dependencies.retrieveOpenAiModel ?? retrieveOpenAiModel)(input)
    else
      await retrieveGoogleModel(input, dependencies.fetchGoogleModel ?? fetch)
  } catch (error) {
    throw validationError(input, error)
  }
}
