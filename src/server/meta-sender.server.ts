/** Adaptador da Graph API; nenhuma chamada externa ocorre antes do compliance. */
import '@tanstack/react-start/server-only'
import { evaluateCompliance } from './compliance'
import type { ComplianceInput } from './compliance'
import { getServerEnv } from './env.server'

export type MetaSendInput = ComplianceInput & {
  recipientId: string
  accessToken?: string
}

/** Envia uma DM ou simula o envio quando `DEMO_MODE=true`. */
export async function sendInstagramMessage(input: MetaSendInput) {
  const decision = evaluateCompliance(input)
  if (!decision.allowed) return { sent: false as const, decision }

  const env = getServerEnv()
  const token = input.accessToken ?? env.META_ACCESS_TOKEN
  if (!token || env.DEMO_MODE === 'true') {
    return {
      sent: true as const,
      demo: true,
      messageId: `demo_${Date.now()}`,
      decision,
    }
  }

  const payload: Record<string, unknown> = {
    recipient: { id: input.recipientId },
    message: { text: decision.body },
  }
  if (decision.tag) payload.messaging_type = 'MESSAGE_TAG'
  if (decision.tag) payload.tag = decision.tag

  const response = await fetch(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/me/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      `Meta Graph API ${response.status}: ${JSON.stringify(result)}`,
    )
  return { sent: true as const, demo: false, result, decision }
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
  if (!decision.allowed) return { sent: false as const, decision }

  const env = getServerEnv()
  const token = input.accessToken ?? env.META_ACCESS_TOKEN
  if (!token || env.DEMO_MODE === 'true')
    return {
      sent: true as const,
      demo: true,
      messageId: `demo_private_${Date.now()}`,
      decision,
    }

  const response = await fetch(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(input.instagramCommentId)}/private_replies`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: decision.body }),
    },
  )
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      `Meta Private Reply ${response.status}: ${JSON.stringify(result)}`,
    )
  return { sent: true as const, demo: false, result, decision }
}
