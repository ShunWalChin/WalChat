/** Contratos da Graph API para Embedded Signup, paginação e assinatura da WABA. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWhatsAppMessageTemplates,
  subscribeWhatsAppBusinessAccount,
  whatsappSubscriptionsIncludeApp,
  whatsappTokenTargetsWaba,
} from './whatsapp-api.server'

const originalEnv = {
  META_WHATSAPP_APP_SECRET: process.env.META_WHATSAPP_APP_SECRET,
  META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
}

describe('WhatsApp Cloud API client', () => {
  beforeEach(() => {
    process.env.META_WHATSAPP_APP_SECRET = 'whatsapp-app-secret'
    process.env.META_GRAPH_VERSION = 'v25.0'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('assina a WABA usando Bearer e appsecret_proof', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    await subscribeWhatsAppBusinessAccount({
      wabaId: '123456789',
      accessToken: 'token-seguro',
    })

    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const url = new URL(input)
    expect(url.pathname).toBe('/v25.0/123456789/subscribed_apps')
    expect(url.searchParams.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/)
    expect(init).toMatchObject({ method: 'POST' })
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-seguro' })
  })

  it('pagina templates somente por cursor reconstruído na Graph API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { name: 'boas_vindas', language: 'pt_BR', status: 'APPROVED' },
          ],
          paging: { cursors: { after: 'cursor-2' }, next: 'https://evil.test' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [{ name: 'retomada', language: 'pt_BR', status: 'PENDING' }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getWhatsAppMessageTemplates({
      wabaId: '123456789',
      accessToken: 'token-seguro',
    })

    expect(result.data).toHaveLength(2)
    expect(new URL(fetchMock.mock.calls[1]?.[0] as URL).origin).toBe(
      'https://graph.facebook.com',
    )
    expect(
      new URL(fetchMock.mock.calls[1]?.[0] as URL).searchParams.get('after'),
    ).toBe('cursor-2')
  })

  it('confirma alvo granular e a identidade do app assinado', () => {
    expect(
      whatsappTokenTargetsWaba(
        [
          {
            scope: 'whatsapp_business_management',
            target_ids: ['waba-1'],
          },
        ],
        'waba-1',
      ),
    ).toBe(true)
    expect(
      whatsappSubscriptionsIncludeApp(
        [{ whatsapp_business_api_data: { id: 'app-1' } }],
        'app-1',
      ),
    ).toBe(true)
    expect(whatsappSubscriptionsIncludeApp([{ id: 'outro' }], 'app-1')).toBe(
      false,
    )
  })

  it('sanitiza erros da Meta sem refletir payload sensível', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: { message: 'token-seguro', code: 190, error_subcode: 463 },
          },
          { status: 401 },
        ),
      ),
    )
    await expect(
      subscribeWhatsAppBusinessAccount({
        wabaId: '123456789',
        accessToken: 'token-seguro',
      }),
    ).rejects.toThrow('HTTP 401, código 190')
  })
})
