/** Claim persistente que transforma retry de DM em replay, nunca em segundo envio. */
import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import type { ComplianceDecision } from './compliance'
import { getSupabaseAdmin } from './supabase-admin.server'

export type OutboundDeliverySource = 'manual' | 'scheduled'
export type OutboundDeliveryStatus =
  'claimed' | 'sent' | 'blocked' | 'failed' | 'unknown'

type ExistingDelivery = {
  id: string
  request_fingerprint: string
  status: OutboundDeliveryStatus
  message_body: string
  policy_used: ComplianceDecision['policy']
  decision_reason: ComplianceDecision['reason'] | null
  requested_tag: string | null
  seconds_left_24h: number
  provider_message_id: string | null
}

export class OutboundDeliveryError extends Error {
  readonly terminal = true

  constructor(
    readonly code:
      | 'missing_idempotency_key'
      | 'idempotency_conflict'
      | 'delivery_in_progress'
      | 'delivery_unknown'
      | 'delivery_failed'
      | 'external_sends_disabled',
    message: string,
    readonly httpStatus = 409,
  ) {
    super(message)
    this.name = 'OutboundDeliveryError'
  }
}

/** Aceita somente uma chave opaca curta, segura para header, log e índice. */
export function normalizeIdempotencyKey(value: string | null | undefined) {
  const normalized = value?.trim()
  if (
    !normalized ||
    normalized.length < 16 ||
    normalized.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(normalized)
  )
    throw new OutboundDeliveryError(
      'missing_idempotency_key',
      'Idempotency-Key ausente ou inválida.',
      400,
    )
  return normalized
}

/** O banco guarda somente o hash da intenção; nenhuma mensagem entra na chave. */
export function fingerprintOutboundDelivery(input: {
  workspaceId: string
  platform?: 'instagram' | 'whatsapp'
  instagramAccountId?: string
  whatsappAccountId?: string
  recipientId: string
  decision: ComplianceDecision
  messageType?: 'text' | 'image' | 'video' | 'template'
  templateName?: string
  templateLanguage?: string
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.workspaceId,
        input.platform ?? 'instagram',
        input.instagramAccountId ?? input.whatsappAccountId,
        input.recipientId,
        input.decision.allowed,
        input.decision.policy,
        input.decision.body,
        input.decision.tag ?? null,
        input.decision.reason ?? null,
        input.messageType ?? 'text',
        input.templateName ?? null,
        input.templateLanguage ?? null,
      ]),
    )
    .digest('hex')
}

/** Decide o retry usando exclusivamente o registro já persistido. */
export function resolveExistingDelivery(
  existing: ExistingDelivery,
  expectedFingerprint: string,
) {
  if (existing.request_fingerprint !== expectedFingerprint)
    throw new OutboundDeliveryError(
      'idempotency_conflict',
      'Esta Idempotency-Key já pertence a outra requisição.',
    )
  if (existing.status === 'claimed')
    throw new OutboundDeliveryError(
      'delivery_in_progress',
      'O envio com esta chave ainda está em processamento.',
    )
  if (existing.status === 'unknown')
    throw new OutboundDeliveryError(
      'delivery_unknown',
      'O resultado desse envio é ambíguo e exige confirmação manual.',
    )
  if (existing.status === 'failed')
    throw new OutboundDeliveryError(
      'delivery_failed',
      'A Meta recusou este envio. Corrija a causa e use uma nova Idempotency-Key.',
      502,
    )

  const decision: ComplianceDecision = {
    allowed: existing.status === 'sent',
    policy: existing.policy_used,
    body: existing.message_body,
    ...(existing.requested_tag ? { tag: existing.requested_tag } : {}),
    ...(existing.decision_reason ? { reason: existing.decision_reason } : {}),
    secondsLeft24h: existing.seconds_left_24h,
  }
  return {
    kind: 'replay' as const,
    deliveryId: existing.id,
    sent: existing.status === 'sent',
    providerMessageId: existing.provider_message_id ?? undefined,
    decision,
  }
}

/** Insere o claim antes da rede; conflito nunca dispara uma segunda chamada Meta. */
export async function claimOutboundDelivery(input: {
  workspaceId: string
  platform?: 'instagram' | 'whatsapp'
  instagramAccountId?: string
  whatsappAccountId?: string
  contactId: string
  recipientId: string
  idempotencyKey: string
  source: OutboundDeliverySource
  scheduledJobId?: string
  decision: ComplianceDecision
  messageType?: 'text' | 'image' | 'video' | 'template'
  templateName?: string
  templateLanguage?: string
}) {
  const supabase = getSupabaseAdmin()
  if (!supabase)
    throw new Error('Supabase administrativo indisponível para idempotência.')
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  const requestFingerprint = fingerprintOutboundDelivery(input)
  const status: OutboundDeliveryStatus = input.decision.allowed
    ? 'claimed'
    : 'blocked'
  const { data, error } = await supabase
    .from('outbound_deliveries')
    .insert({
      workspace_id: input.workspaceId,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      source: input.source,
      scheduled_job_id: input.scheduledJobId ?? null,
      platform: input.platform ?? 'instagram',
      instagram_account_id: input.instagramAccountId ?? null,
      whatsapp_account_id: input.whatsappAccountId ?? null,
      contact_id: input.contactId,
      recipient_id: input.recipientId,
      message_body: input.decision.body,
      policy_used: input.decision.policy,
      decision_reason: input.decision.reason ?? null,
      requested_tag: input.decision.tag ?? null,
      seconds_left_24h: input.decision.secondsLeft24h,
      message_type: input.messageType ?? 'text',
      template_name: input.templateName ?? null,
      template_language: input.templateLanguage ?? null,
      status,
      completed_at: status === 'blocked' ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (!error)
    return {
      kind: 'new' as const,
      deliveryId: data.id,
      decision: input.decision,
    }
  if (error.code !== '23505') throw error

  const { data: existing, error: existingError } = await supabase
    .from('outbound_deliveries')
    .select(
      'id,request_fingerprint,status,message_body,policy_used,decision_reason,requested_tag,seconds_left_24h,provider_message_id',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (existingError) throw existingError
  if (!existing)
    throw new OutboundDeliveryError(
      'idempotency_conflict',
      'A entrega já foi reservada com outra chave.',
    )
  return resolveExistingDelivery(existing, requestFingerprint)
}

export async function markOutboundDeliverySent(
  deliveryId: string,
  providerMessageId?: string,
) {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase administrativo indisponível.')
  const { data, error } = await supabase
    .from('outbound_deliveries')
    .update({
      status: 'sent',
      provider_message_id: providerMessageId ?? null,
      completed_at: new Date().toISOString(),
      last_error_code: null,
    })
    .eq('id', deliveryId)
    .eq('status', 'claimed')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Claim de entrega não está mais disponível.')
}

/** Timeout ou exceção de rede é ambíguo; o estado exige conciliação humana. */
export async function markOutboundDeliveryUnknown(
  deliveryId: string,
  errorCode: string,
) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return
  await supabase
    .from('outbound_deliveries')
    .update({
      status: 'unknown',
      last_error_code: errorCode.slice(0, 80),
      completed_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)
    .eq('status', 'claimed')
}

/** Uma resposta HTTP da Meta é uma falha definida, não um resultado ambíguo. */
export async function markOutboundDeliveryFailed(
  deliveryId: string,
  errorCode: string,
) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return
  await supabase
    .from('outbound_deliveries')
    .update({
      status: 'failed',
      last_error_code: errorCode.slice(0, 80),
      completed_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)
    .eq('status', 'claimed')
}
