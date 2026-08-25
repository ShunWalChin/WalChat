/** Adaptador da Graph API; nenhuma chamada externa ocorre antes do compliance. */
import '@tanstack/react-start/server-only'
import type { AutomationChoice } from './channel-choices'
import { instagramQuickReplies } from './channel-choices'
import { evaluateCompliance } from './compliance'
import type { ComplianceInput } from './compliance'
import { getServerEnv } from './env.server'
import { assertWorkspaceExternalSendsEnabled } from './go-live.server'
import { getMetaAccountAccess } from './integration-credentials.server'
import {
  OutboundDeliveryError,
  claimOutboundDelivery,
  markOutboundDeliveryFailed,
  markOutboundDeliverySent,
  markOutboundDeliveryUnknown,
} from './outbound-delivery.server'
import type { OutboundDeliverySource } from './outbound-delivery.server'

export type MetaSendInput = ComplianceInput & {
  workspaceId: string
  instagramAccountId: string
  recipientId: string
  contactId?: string
  idempotencyKey?: string
  deliverySource?: OutboundDeliverySource
  scheduledJobId?: string
  accessToken?: string
  instagramUserId?: string
  mediaUrl?: string | null
  mediaType?: 'image' | 'video'
  /** Escolhas viram quick replies; o nó só entra no payload para diagnóstico. */
  choices?: Array<AutomationChoice> | null
  choiceNodeId?: string | null
}

export const META_SEND_TIMEOUT_MS = 15_000

type MetaSendErrorPayload = {
  error?: { code?: number; error_subcode?: number }
}

export class MetaProviderResponseError extends Error {
  readonly terminal = true

  constructor(
    message: string,
    readonly errorCode: string,
  ) {
    super(message)
    this.name = 'MetaProviderResponseError'
  }
}

/** Mantém PII e payloads da Graph API fora de exceções, banco e logs. */
export async function parseMetaSendResponse(
  response: Response,
  operation: 'message' | 'private_reply' | 'whatsapp_message',
) {
  const payload = (await response
    .json()
    .catch(() => ({}))) as MetaSendErrorPayload & Record<string, unknown>
  if (!response.ok || payload.error) {
    const code = payload.error?.code
    const subcode = payload.error?.error_subcode
    throw new MetaProviderResponseError(
      `Meta ${operation} recusado (HTTP ${response.status}${code ? `, código ${code}` : ''}${subcode ? `, subcódigo ${subcode}` : ''}).`,
      `meta_http_${response.status}${code ? `_code_${code}` : ''}${subcode ? `_subcode_${subcode}` : ''}`,
    )
  }
  return payload
}

/** Envia uma DM ou simula o envio quando `DEMO_MODE=true`. */
export async function sendInstagramMessage(input: MetaSendInput) {
  const decision = evaluateCompliance(input)
  const env = getServerEnv()
  if (env.DEMO_MODE === 'true') {
    return {
      sent: decision.allowed,
      demo: true,
      ...(decision.allowed ? { messageId: `demo_${Date.now()}` } : {}),
      decision,
    }
  }

  await assertWorkspaceExternalSendsEnabled(input.workspaceId)

  if (!input.contactId || !input.idempotencyKey || !input.deliverySource)
    throw new OutboundDeliveryError(
      'missing_idempotency_key',
      'Envio real exige contato, origem e Idempotency-Key.',
      400,
    )

  let account:
    | { accessToken?: string; instagramUserId?: string }
    | Awaited<ReturnType<typeof getMetaAccountAccess>>
    | undefined
  if (decision.allowed) {
    account = input.accessToken
      ? {
          accessToken: input.accessToken,
          instagramUserId: input.instagramUserId,
        }
      : await getMetaAccountAccess({
          workspaceId: input.workspaceId,
          instagramAccountId: input.instagramAccountId,
        })
    if (!account.accessToken || !account.instagramUserId)
      throw new Error('Credencial Meta da conta está incompleta.')
  }

  const delivery = await claimOutboundDelivery({
    workspaceId: input.workspaceId,
    instagramAccountId: input.instagramAccountId,
    contactId: input.contactId,
    recipientId: input.recipientId,
    idempotencyKey: input.idempotencyKey,
    source: input.deliverySource,
    scheduledJobId: input.scheduledJobId,
    decision,
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

  const message: Record<string, unknown> = input.mediaUrl
    ? {
        attachment: {
          type: input.mediaType ?? 'image',
          payload: { url: input.mediaUrl },
        },
      }
    : { text: decision.body }
  // A Graph API aceita quick replies tanto na mensagem de texto quanto na de
  // anexo, então o botão não obriga o fluxo a abrir mão da mídia.
  if (input.choices?.length)
    message.quick_replies = instagramQuickReplies(
      input.choiceNodeId ?? 'node',
      input.choices,
    )
  const payload: Record<string, unknown> = {
    recipient: { id: input.recipientId },
    message,
  }
  if (decision.tag) payload.tag = decision.tag

  try {
    const response = await fetch(
      `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(account?.instagramUserId ?? '')}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account?.accessToken ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(META_SEND_TIMEOUT_MS),
      },
    )
    const result = await parseMetaSendResponse(response, 'message')
    const providerMessageId =
      typeof result.message_id === 'string' ? result.message_id : undefined
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

/**
 * Envia uma Private Reply para um comentário.
 * A unicidade do comentário é conferida pelo scheduler/banco antes desta chamada.
 */
export async function sendInstagramPrivateReply(
  input: MetaSendInput & { instagramCommentId: string },
) {
  const decision = evaluateCompliance({
    ...input,
    commentAlreadyReplied: false,
    instagramCommentId: input.instagramCommentId,
  })
  const env = getServerEnv()
  if (env.DEMO_MODE === 'true')
    return {
      sent: decision.allowed,
      demo: true,
      ...(decision.allowed ? { messageId: `demo_private_${Date.now()}` } : {}),
      decision,
    }

  await assertWorkspaceExternalSendsEnabled(input.workspaceId)
  if (!input.contactId || !input.idempotencyKey || !input.deliverySource)
    throw new OutboundDeliveryError(
      'missing_idempotency_key',
      'Private Reply real exige contato, origem e Idempotency-Key.',
      400,
    )

  const delivery = await claimOutboundDelivery({
    workspaceId: input.workspaceId,
    instagramAccountId: input.instagramAccountId,
    contactId: input.contactId,
    recipientId: input.instagramCommentId,
    idempotencyKey: input.idempotencyKey,
    source: input.deliverySource,
    scheduledJobId: input.scheduledJobId,
    decision,
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

  const account = input.accessToken
    ? {
        accessToken: input.accessToken,
        instagramUserId: input.instagramUserId,
      }
    : await getMetaAccountAccess({
        workspaceId: input.workspaceId,
        instagramAccountId: input.instagramAccountId,
      })
  if (!account.accessToken || !account.instagramUserId)
    throw new Error('Credencial Meta da conta está incompleta.')

  try {
    const response = await fetch(
      `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(account.instagramUserId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { comment_id: input.instagramCommentId },
          message: { text: decision.body },
        }),
        signal: AbortSignal.timeout(META_SEND_TIMEOUT_MS),
      },
    )
    const result = await parseMetaSendResponse(response, 'private_reply')
    const providerMessageId =
      typeof result.message_id === 'string' ? result.message_id : undefined
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
