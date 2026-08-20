/** Normalização defensiva dos principais formatos inbound do WhatsApp. */
import { describe, expect, it } from 'vitest'
import { normalizeWhatsAppMessage } from './whatsapp-webhook-processor.server'

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
})
