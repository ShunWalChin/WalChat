/** Healthcheck local de worker: valida serviço, estado e idade do heartbeat. */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const allowedServices = new Set(['scheduler', 'webhooks'])

export function evaluateWorkerHeartbeat(
  heartbeat,
  { service, maxAgeSeconds, now = Date.now() },
) {
  if (!allowedServices.has(service))
    return { ok: false, reason: 'invalid_service' }
  if (
    !heartbeat ||
    heartbeat.service !== service ||
    heartbeat.status !== 'healthy'
  )
    return { ok: false, reason: 'unhealthy' }
  const checkedAt = Date.parse(heartbeat.checkedAt)
  if (!Number.isFinite(checkedAt))
    return { ok: false, reason: 'invalid_timestamp' }
  if (now - checkedAt > maxAgeSeconds * 1_000)
    return { ok: false, reason: 'stale' }
  return { ok: true, reason: 'healthy' }
}

async function main() {
  const service = process.argv[2]
  const maxAgeSeconds = Number(process.argv[3] ?? 180)
  if (
    !service ||
    !allowedServices.has(service) ||
    !Number.isFinite(maxAgeSeconds) ||
    maxAgeSeconds <= 0
  ) {
    console.error(
      JSON.stringify({ event: 'worker_health_invalid_arguments', service }),
    )
    process.exitCode = 2
    return
  }
  try {
    const raw = await readFile(
      `/tmp/wal-chat-${service}-heartbeat.json`,
      'utf8',
    )
    const result = evaluateWorkerHeartbeat(JSON.parse(raw), {
      service,
      maxAgeSeconds,
    })
    if (!result.ok) {
      console.error(
        JSON.stringify({
          event: 'worker_health_failed',
          service,
          reason: result.reason,
        }),
      )
      process.exitCode = 1
    }
  } catch {
    console.error(
      JSON.stringify({
        event: 'worker_health_failed',
        service,
        reason: 'heartbeat_unavailable',
      }),
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await main()
