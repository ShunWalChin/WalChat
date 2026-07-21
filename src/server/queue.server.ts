/** Persistência idempotente e enqueue dos eventos Instagram. */
import '@tanstack/react-start/server-only'
import { createHash, randomUUID } from 'node:crypto'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { getServerEnv } from './env.server'
import { getSupabaseAdmin } from './supabase-admin.server'

type InstagramPayload = Record<string, unknown>

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

  if (supabase) {
    const { error } = await supabase.from('webhook_events').upsert(
      {
        meta_event_key: metaEventKey,
        instagram_user_id: extractInstagramUserId(payload),
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
    const queue = new Queue('instagram-webhooks', { connection })
    const job = await queue.add(
      'process-instagram-event',
      { payload, metaEventKey },
      {
        jobId: metaEventKey,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    )
    await queue.close()
    await connection.quit()
    return { id: job.id ?? metaEventKey, backend: 'bullmq' as const }
  }

  return {
    id: supabase ? metaEventKey : randomUUID(),
    backend: supabase ? ('supabase-outbox' as const) : ('demo-memory' as const),
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
