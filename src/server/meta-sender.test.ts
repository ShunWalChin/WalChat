/** Contrato do sender: compliance antes da rede e erros Meta sem payload sensível. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  META_SEND_TIMEOUT_MS,
  parseMetaSendResponse,
} from './meta-sender.server'

const originalDemoMode = process.env.DEMO_MODE

afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.DEMO_MODE
  else process.env.DEMO_MODE = originalDemoMode
  vi.unstubAllGlobals()
})

describe('sendInstagramMessage', () => {
  it('sanitiza erro externo e mantém timeout operacional curto', async () => {
    let caught: unknown
    try {
      await parseMetaSendResponse(
        Response.json(
          {
            error: {
              message: 'token-secreto e contato@exemplo.com',
              code: 190,
              error_subcode: 463,
            },
          },
          { status: 401 },
        ),
        'message',
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('HTTP 401, código 190')
    expect((caught as Error).message).not.toContain('token-secreto')
    expect((caught as Error).message).not.toContain('contato@exemplo.com')
    expect(META_SEND_TIMEOUT_MS).toBe(15_000)
  })

  it('aceita resposta de sucesso sem alterar o payload', async () => {
    await expect(
      parseMetaSendResponse(
        Response.json(
          {
            message_id: 'meta-message',
            recipient_id: 'recipient',
          },
          { status: 200 },
        ),
        'message',
      ),
    ).resolves.toMatchObject({ message_id: 'meta-message' })
  })
})
