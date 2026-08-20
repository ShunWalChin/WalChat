/** Heartbeat atômico e sem dados sensíveis para processos que não expõem HTTP. */
import { rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type WorkerService = 'scheduler' | 'webhooks'
export type WorkerHeartbeatStatus = 'starting' | 'healthy' | 'unhealthy'

export type WorkerHeartbeat = {
  service: WorkerService
  status: WorkerHeartbeatStatus
  checkedAt: string
  detailCode?: string
}

export function workerHeartbeatPath(
  service: WorkerService,
  directory = process.env.WORKER_HEALTH_DIR ?? '/tmp',
) {
  return path.join(directory, `wal-chat-${service}-heartbeat.json`)
}

/** Rename no mesmo filesystem evita que o healthcheck leia JSON incompleto. */
export async function writeWorkerHeartbeat(
  service: WorkerService,
  status: WorkerHeartbeatStatus,
  options?: {
    directory?: string
    now?: Date
    detailCode?: string
  },
) {
  const target = workerHeartbeatPath(service, options?.directory)
  const temporary = `${target}.${process.pid}.tmp`
  const heartbeat: WorkerHeartbeat = {
    service,
    status,
    checkedAt: (options?.now ?? new Date()).toISOString(),
    ...(options?.detailCode ? { detailCode: options.detailCode } : {}),
  }
  await writeFile(temporary, `${JSON.stringify(heartbeat)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporary, target)
  return heartbeat
}
