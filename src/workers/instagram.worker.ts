/** Processo dedicado que consome a fila de webhooks e normaliza eventos no Supabase. */
import { Worker } from 'bullmq'
import IORedis from 'ioredis'
import { getServerEnv } from '../server/env.server'
import { processInstagramWebhook } from '../server/webhook-processor.server'

const env = getServerEnv()
if (!env.REDIS_URL)
  throw new Error('REDIS_URL é obrigatório para iniciar o worker de webhooks.')

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
// Concorrência moderada absorve picos sem permitir que um único tenant monopolize o processo.
const worker = new Worker(
  'instagram-webhooks',
  async (job) => {
    return processInstagramWebhook(job.data.payload, job.data.metaEventKey)
  },
  { connection, concurrency: 12, limiter: { max: 120, duration: 1_000 } },
)

worker.on('completed', (job, result) =>
  console.log(
    JSON.stringify({ event: 'webhook_processed', jobId: job.id, result }),
  ),
)
worker.on('failed', (job, error) =>
  console.error(
    JSON.stringify({
      event: 'webhook_failed',
      jobId: job?.id,
      error: error.message,
    }),
  ),
)

/** Fecha worker e conexão Redis para permitir encerramento limpo pelo Docker. */
async function shutdown() {
  await worker.close()
  await connection.quit()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
