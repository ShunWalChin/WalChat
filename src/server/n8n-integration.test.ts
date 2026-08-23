import type { lookup } from 'node:dns/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { n8nInboundEventSchema } from './n8n-contract'
import {
  assertSafeN8nUrl,
  normalizeN8nBaseUrl,
  payloadSha256,
  signN8nPayload,
  verifyN8nPayload,
} from './n8n-integration.server'

describe('assinatura dos webhooks n8n', () => {
  it('assina os bytes exatos com timestamp e SHA-256', () => {
    const body = '{"schemaVersion":1}'
    const timestamp = '1787356800'
    const signature = signN8nPayload(
      body,
      timestamp,
      'segredo-de-teste-com-mais-de-24',
    )

    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(
      verifyN8nPayload({
        rawBody: body,
        timestamp,
        signature,
        secret: 'segredo-de-teste-com-mais-de-24',
        now: Number(timestamp) * 1_000,
      }),
    ).toBe(true)
    expect(payloadSha256(body)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejeita corpo alterado, assinatura incorreta e timestamp expirado', () => {
    const timestamp = '1787356800'
    const signature = signN8nPayload(
      '{}',
      timestamp,
      'segredo-de-teste-com-mais-de-24',
    )
    expect(
      verifyN8nPayload({
        rawBody: '{ }',
        timestamp,
        signature,
        secret: 'segredo-de-teste-com-mais-de-24',
        now: Number(timestamp) * 1_000,
      }),
    ).toBe(false)
    expect(
      verifyN8nPayload({
        rawBody: '{}',
        timestamp,
        signature,
        secret: 'outro-segredo-com-mais-de-24-caracteres',
        now: Number(timestamp) * 1_000,
      }),
    ).toBe(false)
    expect(
      verifyN8nPayload({
        rawBody: '{}',
        timestamp,
        signature,
        secret: 'segredo-de-teste-com-mais-de-24',
        now: Number(timestamp) * 1_000 + 301_000,
      }),
    ).toBe(false)
  })
})

describe('proteção SSRF da conexão n8n', () => {
  const previousDemoMode = process.env.DEMO_MODE
  const publicResolver = (async () => [
    { address: '203.0.113.20', family: 4 },
  ]) as unknown as typeof lookup

  beforeAll(() => {
    process.env.DEMO_MODE = 'false'
  })
  afterAll(() => {
    if (previousDemoMode === undefined) delete process.env.DEMO_MODE
    else process.env.DEMO_MODE = previousDemoMode
  })

  it('aceita HTTPS público e normaliza a barra final', async () => {
    const result = await assertSafeN8nUrl(
      'https://automacoes.exemplo.com/',
      publicResolver,
    )
    expect(normalizeN8nBaseUrl(result)).toBe('https://automacoes.exemplo.com')
  })

  it.each([
    'http://10.0.0.2:5678',
    'https://127.0.0.1:5678',
    'https://169.254.169.254/latest/meta-data',
    'ftp://automacoes.exemplo.com',
    'https://usuario:senha@automacoes.exemplo.com',
  ])('rejeita destino perigoso %s', async (url) => {
    await expect(assertSafeN8nUrl(url, publicResolver)).rejects.toThrow()
  })
})

describe('contrato inbound do n8n', () => {
  it('aceita upsert de contato manual com identidade estável', () => {
    expect(
      n8nInboundEventSchema.parse({
        schemaVersion: 1,
        eventType: 'contact.upsert',
        data: {
          externalId: 'crm-123',
          fullName: 'Ana Souza',
          email: 'ana@example.com',
        },
      }).eventType,
    ).toBe('contact.upsert')
  })

  it('aceita atualização parcial quando o externalId já estiver vinculado', () => {
    const result = n8nInboundEventSchema.parse({
      schemaVersion: 1,
      eventType: 'contact.upsert',
      data: { externalId: 'crm-123', leadScore: 90 },
    })
    expect(result.data).toEqual({ externalId: 'crm-123', leadScore: 90 })
  })

  it('rejeita evento, versão e ação não permitidos', () => {
    expect(() =>
      n8nInboundEventSchema.parse({
        schemaVersion: 2,
        eventType: 'shell.execute',
        data: { command: 'whoami' },
      }),
    ).toThrow()
  })
})
