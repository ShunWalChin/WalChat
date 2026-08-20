/** Contrato do arquivo consumido pelo healthcheck dos containers sem HTTP. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workerHeartbeatPath, writeWorkerHeartbeat } from './worker-heartbeat'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      const resolved = path.resolve(directory)
      if (!resolved.startsWith(path.resolve(os.tmpdir())))
        throw new Error('Diretório temporário fora da raiz esperada.')
      await rm(resolved, { recursive: true, force: true })
    }),
  )
})

describe('writeWorkerHeartbeat', () => {
  it('grava estado sanitizado no caminho estável do serviço', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'wal-chat-health-'))
    temporaryDirectories.push(directory)
    await writeWorkerHeartbeat('scheduler', 'unhealthy', {
      directory,
      now: new Date('2026-07-30T20:00:00.000Z'),
      detailCode: 'dependency_unavailable',
    })

    const raw = await readFile(
      workerHeartbeatPath('scheduler', directory),
      'utf8',
    )
    expect(JSON.parse(raw)).toEqual({
      service: 'scheduler',
      status: 'unhealthy',
      checkedAt: '2026-07-30T20:00:00.000Z',
      detailCode: 'dependency_unavailable',
    })
    expect(raw).not.toMatch(/token|password|secret/i)
  })
})
