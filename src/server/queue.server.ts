/** Persistência idempotente e enqueue dos eventos Instagram. */
import '@tanstack/react-start/server-only'
import { createHash, randomUUID } from 'node:crypto'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { getServerEnv } from './env.server'
import { getSupabaseAdmin } from './supabase-admin.server'

type InstagramPayload = Record<string, unknown>

export const INSTAGRAM_WEBHOOK_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
}

/**
 * Usa SHA-256 do corpo como chave compartilhada entre Postgres e BullMQ.
 * O fallback retorna o backend usado para que observabilidade e smoke possam validar o caminho.
 */
export async function enqueueInstagramWebhook(
  payload: InstagramPayload,
  rawBody: string,
) {
  const env = getServerEnv()
  const metaEventKey = createHash('sha256').update(rawBody).digest('hex')
  const supabase = getSupabaseAdmin()
  const instagramUserId = extractInstagramUserId(payload)

  if (supabase) {
    const { data: account, error: accountError } = instagramUserId
      ? await supabase
          .from('instagram_accounts')
          .select('workspace_id')
          .eq('instagram_user_id', instagramUserId)
          .eq('status', 'connected')
          .maybeSingle()
      : { data: null, error: null }
    if (accountError) throw accountError
    const { error } = await supabase.from('webhook_events').upsert(
      {
        meta_event_key: metaEventKey,
        workspace_id: account?.workspace_id ?? null,
        instagram_user_id: instagramUserId,
        event_type: extractEventType(payload),
        payload,
        signature_valid: true,
        status: 'queued',
      },
      { onConflict: 'meta_event_key', ignoreDuplicates: true },
    )
    if (error)
      throw new Error(`Não foi possível persistir o webhook: ${error.message}`)
  }

  if (env.REDIS_URL) {
    const connection = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    })
    connection.on('error', () => undefined)
    const queue = new Queue('instagram-webhooks', { connection })
    try {
      const job = await queue.add(
        'process-instagram-event',
        { payload, metaEventKey },
        {
          jobId: metaEventKey,
          ...INSTAGRAM_WEBHOOK_JOB_OPTIONS,
        },
      )
      return { id: job.id ?? metaEventKey, backend: 'bullmq' as const }
    } finally {
      await Promise.allSettled([queue.close(), connection.quit()])
      connection.disconnect()
    }
  }

  // O outbox ainda não possui reconciliador. Em live, devolver erro força a Meta
  // a tentar novamente e evita confirmar um evento que ficaria parado no banco.
  if (env.DEMO_MODE === 'false')
    throw new Error('redis_required_for_live_webhook')

  return {
    id: supabase ? metaEventKey : randomUUID(),
    backend: supabase ? ('supabase-outbox' as const) : ('demo-memory' as const),
  }
}

/** Reenfileira apenas o payload persistido; a idempotência das interações evita efeitos duplicados. */
export async function replayInstagramWebhook(input: {
  metaEventKey: string
  payload: InstagramPayload
  replayedBy: string
}) {
  const env = getServerEnv()
  if (!env.REDIS_URL) throw new Error('Redis indisponível para replay.')
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase indisponível para replay.')
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
  connection.on('error', () => undefined)
  const queue = new Queue('instagram-webhooks', { connection })
  try {
    const replayJobId = `replay-${Date.now()}-${input.metaEventKey.slice(0, 16)}`
    const job = await queue.add(
      'process-instagram-event',
      { payload: input.payload, metaEventKey: input.metaEventKey },
      { jobId: replayJobId, ...INSTAGRAM_WEBHOOK_JOB_OPTIONS },
    )
    const { error } = await supabase
      .from('webhook_events')
      .update({
        status: 'queued',
        attempts: 0,
        last_error: null,
        processing_started_at: null,
        processed_at: null,
        duration_ms: null,
        replayed_at: new Date().toISOString(),
        replayed_by: input.replayedBy,
      })
      .eq('meta_event_key', input.metaEventKey)
    if (error) throw error
    return { jobId: job.id ?? replayJobId }
  } finally {
    await Promise.allSettled([queue.close(), connection.quit()])
    connection.disconnect()
  }
}

/** Extrai a conta destinatária sem confiar que o payload externo tenha o formato esperado. */
function extractInstagramUserId(payload: InstagramPayload) {
  const entries = payload.entry
  if (!Array.isArray(entries)) return null
  const first = entries[0]
  return first && typeof first === 'object' && 'id' in first
    ? String(first.id)
    : null
}

function extractEventType(payload: InstagramPayload) {
  const entries = payload.entry
  if (!Array.isArray(entries)) return 'unknown'
  const first = entries[0]
  if (!first || typeof first !== 'object') return 'unknown'
  if ('messaging' in first && Array.isArray(first.messaging)) {
    const message = first.messaging[0]
    if (message && typeof message === 'object') {
      if ('postback' in message) return 'messaging_postbacks'
      if ('reaction' in message) return 'message_reactions'
      if ('message' in message) return 'messages'
      return 'messaging_seen'
    }
  }
  if ('field' in first && typeof first.field === 'string') return first.field
  if ('changes' in first && Array.isArray(first.changes)) {
    const change = first.changes[0]
    if (change && typeof change === 'object' && 'field' in change)
      return String(change.field)
  }
  return 'unknown'
}
