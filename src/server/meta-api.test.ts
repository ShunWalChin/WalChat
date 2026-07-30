/** Contratos HTTP essenciais do OAuth e da assinatura de webhooks da Meta. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMetaAuthorizationUrl,
  exchangeMetaAuthorizationCode,
  META_REQUIRED_SCOPES,
  META_WEBHOOK_FIELDS,
  subscribeMetaWebhooks,
} from './meta-api.server'

const originalEnv = {
  META_APP_ID: process.env.META_APP_ID,
  META_APP_SECRET: process.env.META_APP_SECRET,
  META_OAUTH_REDIRECT_URI: process.env.META_OAUTH_REDIRECT_URI,
  META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
}

describe('Meta Instagram Login client', () => {
  beforeEach(() => {
    process.env.META_APP_ID = '123456789'
    process.env.META_APP_SECRET = 'app-secret-teste'
    process.env.META_OAUTH_REDIRECT_URI =
      'https://wal.example/api/integrations/meta/callback'
    process.env.META_GRAPH_VERSION = 'v25.0'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('gera OAuth com state, redirect exato e todos os scopes atuais', () => {
    const url = new URL(buildMetaAuthorizationUrl('state-anti-csrf'))
    expect(url.origin).toBe('https://www.instagram.com')
    expect(url.searchParams.get('state')).toBe('state-anti-csrf')
    expect(url.searchParams.get('redirect_uri')).toBe(
      process.env.META_OAUTH_REDIRECT_URI,
    )
    expect(url.searchParams.get('scope')?.split(',')).toEqual([
      ...META_REQUIRED_SCOPES,
    ])
  })

  it('normaliza permissions e troca o token curto pelo long-lived', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'short-token',
          user_id: 42,
          permissions:
            'instagram_business_basic,instagram_business_manage_messages',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'long-token',
          token_type: 'bearer',
          expires_in: 5_184_000,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const token = await exchangeMetaAuthorizationCode('oauth-code#_')
    expect(token).toMatchObject({
      accessToken: 'long-token',
      userId: '42',
      scopes: [
        'instagram_business_basic',
        'instagram_business_manage_messages',
      ],
    })
    const firstBody = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(firstBody.get('code')).toBe('oauth-code')
  })

  it('assina todos os campos de webhook no endpoint da conta profissional', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ success: true }))
    vi.stubGlobal('fetch', fetchMock)
    await subscribeMetaWebhooks({
      instagramUserId: '17890001',
      accessToken: 'long-token',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://graph.instagram.com/v25.0/17890001/subscribed_apps',
    )
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer long-token',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      subscribed_fields: META_WEBHOOK_FIELDS,
    })
  })
})
