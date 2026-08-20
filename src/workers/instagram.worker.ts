/** Processo dedicado que consome a fila de webhooks e normaliza eventos no Supabase. */
import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { getServerEnv } from '../server/env.server'
import { processInstagramWebhook } from '../server/webhook-processor.server'
import { writeWorkerHeartbeat } from '../server/worker-heartbeat'
import {
  reconcileWebhookOutbox,
  recordWebhookJobFailure,
} from '../server/webhook-outbox.server'

const env = getServerEnv()
if (!env.REDIS_URL)
  throw new Error('REDIS_URL é obrigatório para iniciar o worker de webhooks.')

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
const outboxConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})
outboxConnection.on('error', () => undefined)
const outboxQueue = new Queue('instagram-webhooks', {
  connection: outboxConnection,
})
// Concorrência moderada absorve picos sem permitir que um único tenant monopolize o processo.
const worker = new Worker(
  'instagram-webhooks',
  async (job) => {
    return processInstagramWebhook(job.data.payload, job.data.metaEventKey)
  },
  { connection, concurrency: 12, limiter: { max: 120, duration: 1_000 } },
)

let outboxHealthy = true

async function updateHeartbeat() {
  const healthy =
    connection.status === 'ready' && worker.isRunning() && outboxHealthy
  await writeWorkerHeartbeat(
    'webhooks',
    healthy ? 'healthy' : 'unhealthy',
    healthy
      ? undefined
      : {
          detailCode: outboxHealthy
            ? 'redis_or_worker_unavailable'
            : 'outbox_reconciliation_failed',
        },
  )
}

function logHeartbeatFailure() {
  console.error(
    JSON.stringify({
      event: 'webhook_heartbeat_failed',
      error: 'heartbeat_write_failed',
    }),
  )
}

async function runOutboxReconciliation() {
  try {
    const result = await reconcileWebhookOutbox(outboxQueue)
    outboxHealthy = true
    if (result.enqueued || result.failed)
      console.log(
        JSON.stringify({ event: 'webhook_outbox_reconciled', ...result }),
      )
  } catch {
    outboxHealthy = false
    console.error(
      JSON.stringify({
        event: 'webhook_outbox_reconciliation_failed',
        error: 'reconciliation_failed',
      }),
    )
    await updateHeartbeat().catch(logHeartbeatFailure)
  }
}

void writeWorkerHeartbeat('webhooks', 'starting').catch(logHeartbeatFailure)
void worker
  .waitUntilReady()
  .then(async () => {
    await runOutboxReconciliation()
    await updateHeartbeat()
  })
  .catch(() =>
    writeWorkerHeartbeat('webhooks', 'unhealthy', {
      detailCode: 'startup_failed',
    }),
  )
  .catch(logHeartbeatFailure)
const heartbeatInterval = setInterval(
  () => void updateHeartbeat().catch(logHeartbeatFailure),
  30_000,
)
const outboxInterval = setInterval(() => void runOutboxReconciliation(), 60_000)

worker.on('completed', (job, result) =>
  console.log(
    JSON.stringify({ event: 'webhook_processed', jobId: job.id, result }),
  ),
)
worker.on('failed', (job, error) => {
  console.error(
    JSON.stringify({
      event: 'webhook_failed',
      jobId: job?.id,
      error: error.name,
    }),
  )
  if (job)
    void recordWebhookJobFailure({
      metaEventKey: job.data.metaEventKey,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    }).catch(() =>
      console.error(
        JSON.stringify({
          event: 'webhook_failure_state_write_failed',
          error: 'state_write_failed',
        }),
      ),
    )
})
worker.on('error', (error) => {
  console.error(
    JSON.stringify({ event: 'webhook_worker_error', error: error.name }),
  )
  void writeWorkerHeartbeat('webhooks', 'unhealthy', {
    detailCode: 'worker_error',
  }).catch(logHeartbeatFailure)
})

/** Fecha worker e conexão Redis para permitir encerramento limpo pelo Docker. */
async function shutdown() {
  clearInterval(heartbeatInterval)
  clearInterval(outboxInterval)
  await worker.close()
  await outboxQueue.close()
  await outboxConnection.quit()
  await connection.quit()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
