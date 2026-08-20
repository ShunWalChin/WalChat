/** Concilia o outbox persistido com o estado real da fila BullMQ. */
import '@tanstack/react-start/server-only'
import type { Queue } from 'bullmq'
import { INSTAGRAM_WEBHOOK_JOB_OPTIONS } from './queue.server'
import { getSupabaseAdmin } from './supabase-admin.server'

export type WebhookReconciliationAction =
  'enqueue' | 'mark_processed' | 'mark_failed' | 'none'

export function reconciliationAction(
  jobState: string | null,
): WebhookReconciliationAction {
  if (jobState === null || jobState === 'unknown') return 'enqueue'
  if (jobState === 'completed') return 'mark_processed'
  if (jobState === 'failed') return 'mark_failed'
  return 'none'
}

export async function reconcileWebhookOutbox(
  queue: Queue,
  options?: { limit?: number; olderThanMs?: number; now?: Date },
) {
  const supabase = getSupabaseAdmin()
  const counters = { inspected: 0, enqueued: 0, processed: 0, failed: 0 }
  if (!supabase) return counters

  const cutoff = new Date(
    (options?.now ?? new Date()).getTime() - (options?.olderThanMs ?? 30_000),
  ).toISOString()
  const { data: events, error } = await supabase
    .from('webhook_events')
    .select('meta_event_key,payload')
    .eq('status', 'queued')
    .lt('received_at', cutoff)
    .order('received_at')
    .limit(options?.limit ?? 100)
  if (error) throw error

  for (const event of events) {
    counters.inspected++
    const job = await queue.getJob(event.meta_event_key)
    const state = job ? await job.getState() : null
    const action = reconciliationAction(state)
    if (action === 'none') continue

    if (action === 'enqueue') {
      await queue.add(
        'process-instagram-event',
        {
          payload: event.payload,
          metaEventKey: event.meta_event_key,
        },
        {
          jobId: event.meta_event_key,
          ...INSTAGRAM_WEBHOOK_JOB_OPTIONS,
        },
      )
      counters.enqueued++
      continue
    }

    const terminalStatus = action === 'mark_processed' ? 'processed' : 'failed'
    const { error: updateError } = await supabase
      .from('webhook_events')
      .update({
        status: terminalStatus,
        attempts: job?.attemptsMade ?? 0,
        last_error:
          action === 'mark_failed' ? 'bullmq_attempts_exhausted' : null,
        ...(action === 'mark_processed'
          ? { processed_at: new Date().toISOString() }
          : {}),
      })
      .eq('meta_event_key', event.meta_event_key)
      .eq('status', 'queued')
    if (updateError) throw updateError
    counters[action === 'mark_processed' ? 'processed' : 'failed']++
  }

  return counters
}

/** Espelha cada tentativa no Postgres para alertas e análise pós-incidente. */
export async function recordWebhookJobFailure(input: {
  metaEventKey: string
  attemptsMade: number
  maxAttempts: number
}) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return
  const terminal = input.attemptsMade >= input.maxAttempts
  const { error } = await supabase
    .from('webhook_events')
    .update({
      status: terminal ? 'failed' : 'queued',
      attempts: input.attemptsMade,
      last_error: terminal
        ? 'processing_attempts_exhausted'
        : 'processing_attempt_failed',
      last_attempt_at: new Date().toISOString(),
    })
    .eq('meta_event_key', input.metaEventKey)
  if (error) throw error
}
