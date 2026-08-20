/** Leitura limitada de corpos HTTP para impedir exaustão de memória no Node. */
import '@tanstack/react-start/server-only'
import { ApiError } from './api-auth.server'

export const DEFAULT_JSON_BODY_LIMIT = 256 * 1024
export const INSTAGRAM_WEBHOOK_BODY_LIMIT = 1024 * 1024

function assertContentType(request: Request, expected: string) {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith(expected))
    throw new ApiError(415, `Content-Type deve ser ${expected}.`)
}

/** Lê bytes via stream e interrompe assim que o limite é ultrapassado. */
export async function readLimitedText(
  request: Request,
  limitBytes: number,
  expectedContentType?: string,
) {
  if (expectedContentType) assertContentType(request, expectedContentType)
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes)
    throw new ApiError(413, 'Corpo da requisição excede o limite permitido.')
  const body = request.body
  if (body === null) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let received = 0
  let result = ''
  try {
    let finished = false
    while (!finished) {
      const { done, value } = await reader.read()
      finished = done
      if (finished) continue
      if (value === undefined) continue
      received += value.byteLength
      if (received > limitBytes) {
        await reader.cancel()
        throw new ApiError(
          413,
          'Corpo da requisição excede o limite permitido.',
        )
      }
      result += decoder.decode(value, { stream: true })
    }
    result += decoder.decode()
    return result
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'Corpo da requisição contém texto inválido.')
  } finally {
    reader.releaseLock()
  }
}

export async function readJsonBody(
  request: Request,
  limitBytes = DEFAULT_JSON_BODY_LIMIT,
) {
  const text = await readLimitedText(request, limitBytes, 'application/json')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError(400, 'JSON inválido.')
  }
}
