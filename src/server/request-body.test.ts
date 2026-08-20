import { describe, expect, it } from 'vitest'
import { ApiError } from './api-auth.server'
import { readJsonBody, readLimitedText } from './request-body.server'

describe('request body limits', () => {
  it('lê JSON dentro do limite', async () => {
    const request = new Request('https://wal.chat/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    })
    await expect(readJsonBody(request, 100)).resolves.toEqual({ ok: true })
  })

  it('recusa Content-Type e corpo maiores que o limite', async () => {
    const wrongType = new Request('https://wal.chat/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    })
    await expect(readJsonBody(wrongType)).rejects.toMatchObject({ status: 415 })

    const tooLarge = new Request('https://wal.chat/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(100) }),
    })
    await expect(readLimitedText(tooLarge, 16)).rejects.toBeInstanceOf(ApiError)
  })
})
