/** Gateway de saída da WhatsApp Cloud API com compliance e at-most-once. */
import '@tanstack/react-start/server-only'
import { createHmac } from 'node:crypto'
import { evaluateWhatsAppCompliance } from './compliance'
import type { WhatsAppComplianceInput } from './compliance'
import { getServerEnv } from './env.server'
import { assertWorkspaceExternalSendsEnabled } from './go-live.server'
import { getWhatsAppAccountAccess } from './integration-credentials.server'
import {
  MetaProviderResponseError,
  META_SEND_TIMEOUT_MS,
  parseMetaSendResponse,
} from './meta-sender.server'
import {
  OutboundDeliveryError,
  claimOutboundDelivery,
  markOutboundDeliveryFailed,
  markOutboundDeliverySent,
  markOutboundDeliveryUnknown,
} from './outbound-delivery.server'
import type { OutboundDeliverySource } from './outbound-delivery.server'

export type WhatsAppTemplateSend = {
  name: string
  language: string
  status: string
  hasOptOut: boolean
  components?: Array<Record<string, unknown>>
}

export type WhatsAppSendInput = WhatsAppComplianceInput & {
  workspaceId: string
  whatsappAccountId: string
  recipientId: string
  contactId?: string
  idempotencyKey?: string
  deliverySource?: OutboundDeliverySource
  scheduledJobId?: string
  template?: WhatsAppTemplateSend | null
}

function appSecretProof(accessToken: string, appSecret: string) {
  return createHmac('sha256', appSecret).update(accessToken).digest('hex')
}

/** Texto de sessão e templates usam o mesmo claim e nunca fazem retry cego. */
export async function sendWhatsAppMessage(input: WhatsAppSendInput) {
  const decision = evaluateWhatsAppCompliance(input)
  const env = getServerEnv()
  if (env.DEMO_MODE === 'true')
    return {
      sent: decision.allowed,
      demo: true,
      ...(decision.allowed ? { messageId: `demo_wa_${Date.now()}` } : {}),
      decision,
    }

  await assertWorkspaceExternalSendsEnabled(input.workspaceId)
  if (!input.contactId || !input.idempotencyKey || !input.deliverySource)
    throw new OutboundDeliveryError(
      'missing_idempotency_key',
      'Envio real exige contato, origem e Idempotency-Key.',
      400,
    )

  const messageType = input.template ? 'template' : 'text'
  const delivery = await claimOutboundDelivery({
    workspaceId: input.workspaceId,
    platform: 'whatsapp',
    whatsappAccountId: input.whatsappAccountId,
    contactId: input.contactId,
    recipientId: input.recipientId,
    idempotencyKey: input.idempotencyKey,
    source: input.deliverySource,
    scheduledJobId: input.scheduledJobId,
    decision,
    messageType,
    templateName: input.template?.name,
    templateLanguage: input.template?.language,
  })
  if (delivery.kind === 'replay')
    return {
      sent: delivery.sent,
      demo: false,
      replayed: true,
      deliveryId: delivery.deliveryId,
      ...(delivery.providerMessageId
        ? { result: { message_id: delivery.providerMessageId } }
        : {}),
      decision: delivery.decision,
    }
  if (!decision.allowed)
    return {
      sent: false as const,
      demo: false,
      replayed: false,
      deliveryId: delivery.deliveryId,
      decision,
    }

  const account = await getWhatsAppAccountAccess({
    workspaceId: input.workspaceId,
    whatsappAccountId: input.whatsappAccountId,
  })
  if (!env.META_APP_SECRET) throw new Error('META_APP_SECRET não configurado.')
  const url = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(account.phoneNumberId)}/messages`,
  )
  url.searchParams.set(
    'appsecret_proof',
    appSecretProof(account.accessToken, env.META_APP_SECRET),
  )
  const payload = input.template
    ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.recipientId,
        type: 'template',
        template: {
          name: input.template.name,
          language: { code: input.template.language },
          ...(input.template.components?.length
            ? { components: input.template.components }
            : {}),
        },
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.recipientId,
        type: 'text',
        text: { preview_url: false, body: decision.body },
      }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(META_SEND_TIMEOUT_MS),
    })
    const result = await parseMetaSendResponse(response, 'whatsapp_message')
    const messages = Array.isArray(result.messages)
      ? (result.messages as Array<Record<string, unknown>>)
      : []
    const providerMessageId =
      typeof messages[0]?.id === 'string' ? messages[0].id : undefined
    await markOutboundDeliverySent(delivery.deliveryId, providerMessageId)
    return {
      sent: true as const,
      demo: false,
      replayed: false,
      deliveryId: delivery.deliveryId,
      result,
      decision,
    }
  } catch (error) {
    if (error instanceof MetaProviderResponseError) {
      await markOutboundDeliveryFailed(
        delivery.deliveryId,
        error.errorCode,
      ).catch(() => undefined)
      throw new OutboundDeliveryError('delivery_failed', error.message, 502)
    }
    await markOutboundDeliveryUnknown(
      delivery.deliveryId,
      error instanceof Error ? error.name : 'unknown_error',
    ).catch(() => undefined)
    throw error
  }
}
