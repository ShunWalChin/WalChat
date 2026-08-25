import { describe, expect, it } from 'vitest'
import {
  readJsonPath,
  runExternalRequest,
  scalarFromResponse,
} from './automation-engine.server'

/** Resolve o host de teste sempre para um endereço público real. */
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const base = {
  url: 'https://api.exemplo.com/leads',
  method: 'POST',
  headers: [],
  timeoutMs: 5_000,
}

describe('leitura do caminho na resposta', () => {
  it('percorre objetos aninhados', () => {
    expect(readJsonPath({ data: { user: { id: 7 } } }, 'data.user.id')).toBe(7)
  })

  it('devolve indefinido quando o caminho não existe', () => {
    expect(readJsonPath({ data: {} }, 'data.user.id')).toBeUndefined()
    expect(readJsonPath(null, 'data')).toBeUndefined()
  })

  it('não alcança propriedade herdada do protótipo', () => {
    // `toString` existe na cadeia mas não é propriedade própria do objeto.
    expect(readJsonPath({}, 'toString')).toBeUndefined()
    expect(readJsonPath({}, 'constructor')).toBeUndefined()
  })
})

describe('conversão do valor mapeado', () => {
  it('aceita escalares', () => {
    expect(scalarFromResponse('abc')).toBe('abc')
    expect(scalarFromResponse(42)).toBe(42)
    expect(scalarFromResponse(true)).toBe('true')
  })

  it('recusa objeto e nulo, que não cabem num campo', () => {
    expect(scalarFromResponse({ a: 1 })).toBeNull()
    expect(scalarFromResponse([1, 2])).toBeNull()
    expect(scalarFromResponse(null)).toBeNull()
    expect(scalarFromResponse(undefined)).toBeNull()
  })
})

describe('execução da requisição externa', () => {
  it('recusa destino que não é HTTPS antes de qualquer conexão', async () => {
    let chamou = false
    const { outcome } = await runExternalRequest(
      { ...base, url: 'http://api.exemplo.com' },
      async () => {
        chamou = true
        return jsonResponse({})
      },
    )
    expect(outcome.errorCode).toBe('unsafe_target')
    expect(chamou).toBe(false)
  })

  it('recusa IP interno mesmo com HTTPS', async () => {
    let chamou = false
    const { outcome } = await runExternalRequest(
      { ...base, url: 'https://169.254.169.254/latest/meta-data' },
      async () => {
        chamou = true
        return jsonResponse({})
      },
    )
    expect(outcome.errorCode).toBe('unsafe_target')
    expect(chamou).toBe(false)
  })

  it('marca erro quando o destino responde fora da faixa de sucesso', async () => {
    const { outcome } = await runExternalRequest(
      { ...base, url: 'https://93.184.216.34/leads' },
      async () => jsonResponse({ erro: 'x' }, 422),
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.errorCode).toBe('http_422')
  })

  it('devolve o JSON quando a chamada dá certo', async () => {
    const { outcome, payload } = await runExternalRequest(
      { ...base, url: 'https://93.184.216.34/leads' },
      async () => jsonResponse({ data: { id: 'lead_1' } }),
    )
    expect(outcome.ok).toBe(true)
    expect(readJsonPath(payload, 'data.id')).toBe('lead_1')
  })

  it('sobrevive a uma resposta que não é JSON', async () => {
    const { outcome, payload } = await runExternalRequest(
      { ...base, url: 'https://93.184.216.34/leads' },
      async () => new Response('ok', { status: 200 }),
    )
    expect(outcome.ok).toBe(true)
    expect(payload).toBeNull()
  })

  it('trata falha de rede como destino inalcançável', async () => {
    const { outcome } = await runExternalRequest(
      { ...base, url: 'https://93.184.216.34/leads' },
      async () => {
        throw new Error('ECONNRESET')
      },
    )
    expect(outcome.errorCode).toBe('unreachable')
  })

  it('não envia corpo em GET', async () => {
    let recebido: RequestInit | undefined
    await runExternalRequest(
      {
        ...base,
        method: 'GET',
        body: '{"a":1}',
        url: 'https://93.184.216.34/x',
      },
      (async (_url: unknown, init: RequestInit) => {
        recebido = init
        return jsonResponse({})
      }) as unknown as typeof fetch,
    )
    expect(recebido?.body).toBeUndefined()
  })

  it('recusa seguir redirect, que escaparia da validação de destino', async () => {
    let recebido: RequestInit | undefined
    await runExternalRequest(
      { ...base, url: 'https://93.184.216.34/x' },
      (async (_url: unknown, init: RequestInit) => {
        recebido = init
        return jsonResponse({})
      }) as unknown as typeof fetch,
    )
    expect(recebido?.redirect).toBe('error')
  })
})
