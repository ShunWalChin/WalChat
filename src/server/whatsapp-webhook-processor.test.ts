/** Normalização defensiva dos principais formatos inbound do WhatsApp. */
import { describe, expect, it } from 'vitest'
import {
  ctwaAttributionFromWhatsAppMessage,
  normalizeWhatsAppMessage,
} from './whatsapp-webhook-processor.server'

describe('normalizeWhatsAppMessage', () => {
  it('normaliza texto, mídia, botão e localização sem depender do payload bruto', () => {
    expect(
      normalizeWhatsAppMessage({ type: 'text', text: { body: 'Olá' } }),
    ).toEqual({ type: 'text', text: 'Olá', mediaId: null })
    expect(
      normalizeWhatsAppMessage({
        type: 'image',
        image: { id: 'media-1', caption: 'Comprovante' },
      }),
    ).toEqual({ type: 'image', text: 'Comprovante', mediaId: 'media-1' })
    expect(
      normalizeWhatsAppMessage({
        type: 'interactive',
        interactive: { button_reply: { id: 'yes', title: 'Quero' } },
      }),
    ).toMatchObject({ text: 'Quero' })
    expect(
      normalizeWhatsAppMessage({
        type: 'location',
        location: { latitude: -23.5, longitude: -46.6, name: 'São Paulo' },
      }),
    ).toMatchObject({ text: 'São Paulo' })
  })

  it('mantém tipo desconhecido vazio em formato persistível', () => {
    expect(normalizeWhatsAppMessage({})).toEqual({
      type: 'unknown',
      text: '',
      mediaId: null,
    })
  })

  it('extrai a atribuição CTWA com WABA e timestamp do webhook', () => {
    expect(
      ctwaAttributionFromWhatsAppMessage(
        {
          referral: {
            ctwa_clid: 'ctwa-click-123',
            source_id: 'ad-456',
            source_url: 'https://facebook.com/ad?private=value',
            source_type: 'ad',
            headline: 'Fale conosco',
            body: 'Atendimento pelo WhatsApp',
            media_type: 'image',
          },
        },
        'waba-789',
        '2026-09-05T12:00:00.000Z',
      ),
    ).toMatchObject({
      ctwaClid: 'ctwa-click-123',
      ctwaSourceId: 'ad-456',
      ctwaSourceUrl: 'https://facebook.com/ad',
      ctwaSourceType: 'ad',
      ctwaHeadline: 'Fale conosco',
      ctwaBody: 'Atendimento pelo WhatsApp',
      ctwaMediaType: 'image',
      ctwaWabaId: 'waba-789',
      capturedAt: '2026-09-05T12:00:00.000Z',
    })
  })
})
