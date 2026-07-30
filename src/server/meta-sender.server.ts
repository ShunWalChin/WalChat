/** Adaptador da Graph API; nenhuma chamada externa ocorre antes do compliance. */
import '@tanstack/react-start/server-only'
import { evaluateCompliance } from './compliance'
import type { ComplianceInput } from './compliance'
import { getServerEnv } from './env.server'

export type MetaSendInput = ComplianceInput & {
  workspaceId: string
  instagramAccountId: string
  recipientId: string
  accessToken?: string
  instagramUserId?: string
}

/** Envia uma DM ou simula o envio quando `DEMO_MODE=true`. */
export async function sendInstagramMessage(input: MetaSendInput) {
  const decision = evaluateCompliance(input)
  if (!decision.allowed) return { sent: false as const, decision }

  const env = getServerEnv()
  if (env.DEMO_MODE === 'true') {
    return {
      sent: true as const,
      demo: true,
      messageId: `demo_${Date.now()}`,
      decision,
    }
  }

  const { getMetaAccountAccess } =
    await import('./integration-credentials.server')
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

  const payload: Record<string, unknown> = {
    recipient: { id: input.recipientId },
    message: { text: decision.body },
  }
  if (decision.tag) payload.tag = decision.tag

  const response = await fetch(
    `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${encodeURIComponent(account.instagramUserId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
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
  if (env.DEMO_MODE === 'true')
    return {
      sent: true as const,
      demo: true,
      messageId: `demo_private_${Date.now()}`,
      decision,
    }

  const { getMetaAccountAccess } =
    await import('./integration-credentials.server')
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
    },
  )
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      `Meta Private Reply ${response.status}: ${JSON.stringify(result)}`,
    )
  return { sent: true as const, demo: false, result, decision }
}
