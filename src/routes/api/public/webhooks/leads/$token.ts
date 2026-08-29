/** Entrada pública autenticada por token opaco para captação de leads. */
import { createHash } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import {
  ApiError,
  apiErrorResponse,
} from '../../../../../server/api-auth.server'
import { normalizePhone } from '../../../../../server/contacts-crm.server'
import { assertRateLimit } from '../../../../../server/rate-limit.server'
import { readLimitedText } from '../../../../../server/request-body.server'
import { requestIdentity } from '../../../../../server/request-identity.server'
import { getSupabaseAdmin } from '../../../../../server/supabase-admin.server'

const MAX_BODY_BYTES = 64 * 1024
const blockedFieldPattern =
  /(authorization|password|passwd|secret|token|api.?key)/i

function scalar(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return ''
}

function mapped(
  payload: Record<string, unknown>,
  mapping: unknown,
  key: string,
) {
  const source =
    mapping && typeof mapping === 'object' && key in mapping
      ? scalar((mapping as Record<string, unknown>)[key])
      : key
  return scalar(payload[source])
}

function sanitizedPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => !blockedFieldPattern.test(key))
      .slice(0, 100)
      .map(([key, value]) => [
        key.slice(0, 80),
        typeof value === 'string' ? value.slice(0, 2_000) : value,
      ]),
  )
}

async function readPayload(request: Request) {
  // `request.text()` bufferiza o corpo inteiro antes de qualquer checagem, então
  // medir depois já é tarde: o custo de memória foi pago. `readLimitedText` lê
  // em stream e aborta assim que o limite é ultrapassado.
  const text = await readLimitedText(request, MAX_BODY_BYTES)
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/x-www-form-urlencoded'))
    return {
      payload: Object.fromEntries(new URLSearchParams(text)),
      dedupeKey: createHash('sha256').update(text).digest('hex'),
    }
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('not_object')
    return {
      payload: value as Record<string, unknown>,
      dedupeKey: createHash('sha256').update(text).digest('hex'),
    }
  } catch {
    throw new ApiError(400, 'Envie um objeto JSON ou formulário válido.')
  }
}

export const Route = createFileRoute('/api/public/webhooks/leads/$token')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let captureId: string | null = null
        const admin = getSupabaseAdmin()
        try {
          if (!admin)
            throw new ApiError(503, 'Captação temporariamente indisponível.')
          const tokenHash = createHash('sha256')
            .update(params.token)
            .digest('hex')
          await assertRateLimit({
            namespace: 'lead-capture',
            identity: `${tokenHash}:${requestIdentity(request)}`,
            limit: 60,
            windowSeconds: 60,
          })
          const { data: source, error: sourceError } = await admin
            .from('webhook_sources')
            .select(
              'id,workspace_id,pipeline_id,stage_id,field_mapping,is_active',
            )
            .eq('token_hash', tokenHash)
            .maybeSingle()
          if (sourceError) throw sourceError
          if (!source || !source.is_active)
            throw new ApiError(404, 'Fonte de captação não encontrada.')
          if (!source.pipeline_id || !source.stage_id)
            throw new ApiError(409, 'A fonte não possui destino ativo no CRM.')
          const { payload, dedupeKey } = await readPayload(request)
          const { data: capture, error: captureError } = await admin
            .from('webhook_lead_captures')
            .insert({
              workspace_id: source.workspace_id,
              source_id: source.id,
              dedupe_key: dedupeKey,
              status: 'received',
              payload: sanitizedPayload(payload),
            })
            .select('id')
            .single()
          if (captureError?.code === '23505')
            return Response.json({ accepted: true, duplicate: true })
          if (captureError) throw captureError
          captureId = capture.id

          const displayName =
            mapped(payload, source.field_mapping, 'name') || 'Lead capturado'
          const email = mapped(payload, source.field_mapping, 'email')
            .toLocaleLowerCase('pt-BR')
            .slice(0, 254)
          const rawPhone = mapped(payload, source.field_mapping, 'phone')
          const phone = rawPhone ? normalizePhone(rawPhone) : null
          let contactId: string | null = null
          if (email || phone) {
            let contactQuery = admin
              .from('contacts')
              .select('id')
              .eq('workspace_id', source.workspace_id)
            contactQuery = email
              ? contactQuery.ilike('email', email)
              : contactQuery.eq('phone', phone)
            const { data: existing, error: existingError } = await contactQuery
              .limit(1)
              .maybeSingle()
            if (existingError) throw existingError
            if (existing) contactId = existing.id
            else {
              const { data: created, error: contactError } = await admin
                .from('contacts')
                .insert({
                  workspace_id: source.workspace_id,
                  platform: 'manual',
                  instagram_account_id: null,
                  instagram_user_id: null,
                  whatsapp_account_id: null,
                  whatsapp_user_id: null,
                  display_name: displayName.slice(0, 120),
                  email: email || null,
                  phone,
                  lifecycle_stage: 'lead',
                  marketing_consent: 'unknown',
                  import_source: 'webhook',
                  ai_enabled: false,
                })
                .select('id')
                .single()
              if (contactError) throw contactError
              contactId = created.id
            }
          }

          const valueText = mapped(payload, source.field_mapping, 'value')
          const valueNumber = Number(valueText.replace(',', '.'))
          const valueCents = Number.isFinite(valueNumber)
            ? Math.max(0, Math.round(valueNumber * 100))
            : null
          const title =
            mapped(payload, source.field_mapping, 'title') || displayName
          const now = new Date().toISOString()
          const { data: lead, error: leadError } = await admin
            .from('crm_leads')
            .insert({
              workspace_id: source.workspace_id,
              pipeline_id: source.pipeline_id,
              stage_id: source.stage_id,
              contact_id: contactId,
              title: title.slice(0, 160),
              value_cents: valueCents,
              source: 'webhook',
              source_metadata: { sourceId: source.id, captureId },
              last_activity_at: now,
              position_in_stage: Date.now(),
            })
            .select('id')
            .single()
          if (leadError) throw leadError
          await admin.from('crm_lead_activities').insert({
            workspace_id: source.workspace_id,
            lead_id: lead.id,
            contact_id: contactId,
            activity_type: 'lead_captured',
            payload: { sourceId: source.id, captureId },
          })
          const { error: updateError } = await admin
            .from('webhook_lead_captures')
            .update({
              lead_id: lead.id,
              status: 'processed',
              processed_at: now,
            })
            .eq('id', captureId)
          if (updateError) throw updateError
          await admin
            .from('webhook_sources')
            .update({ last_received_at: now })
            .eq('id', source.id)
          return Response.json(
            { accepted: true, captureId, leadId: lead.id },
            { status: 202 },
          )
        } catch (error) {
          if (admin && captureId)
            await admin
              .from('webhook_lead_captures')
              .update({
                status: 'failed',
                error_code:
                  error instanceof ApiError
                    ? `api_${error.status}`
                    : error instanceof Error
                      ? error.name.slice(0, 100)
                      : 'unknown_error',
                processed_at: new Date().toISOString(),
              })
              .eq('id', captureId)
          return apiErrorResponse(error, 'Falha ao captar o lead.')
        }
      },
    },
  },
})
