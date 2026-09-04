/** Alerta externo sanitizado, deduplicado e isolado por workspace. */
import '@tanstack/react-start/server-only'
import { getServerEnv } from './env.server'
import { getSupabaseAdmin } from './supabase-admin.server'

export type OperationalSlo = {
  overall: 'pass' | 'warning' | 'fail'
  generatedAt: string
  services: Array<{
    id: string
    status: 'pass' | 'warning' | 'fail'
    successRate: number | null
    failed: number
    backlog: number
    oldestMinutes: number | null
    p95LatencyMs: number | null
  }>
}

type AlertState = {
  status: OperationalSlo['overall']
  fingerprint: string
  last_notified_at: string | null
}

const REPEAT_AFTER_MS = 30 * 60_000

export function operationalAlertFingerprint(slo: OperationalSlo) {
  return [
    slo.overall,
    ...slo.services.map((service) => `${service.id}:${service.status}`).sort(),
  ].join('|')
}

export function shouldNotifyOperationalAlert(
  slo: OperationalSlo,
  previous: AlertState | null,
  now = Date.now(),
) {
  if (!previous) return slo.overall !== 'pass'
  if (previous.fingerprint !== operationalAlertFingerprint(slo)) return true
  if (slo.overall === 'pass') return false
  const notifiedAt = previous.last_notified_at
    ? new Date(previous.last_notified_at).getTime()
    : 0
  return now - notifiedAt >= REPEAT_AFTER_MS
}

/**
 * Varre no máximo 100 workspaces a cada ciclo e envia somente métricas
 * agregadas. O destino nunca recebe nomes, contatos, mensagens ou credenciais.
 */
export async function dispatchOperationalAlerts() {
  const alertUrl = getServerEnv().OPERATIONS_ALERT_WEBHOOK_URL
  if (!alertUrl) return { checked: 0, notified: 0 }
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('supabase_not_configured')
  const { data: workspaces, error: workspaceError } = await admin
    .from('workspaces')
    .select('id')
    .limit(100)
  if (workspaceError) throw workspaceError

  let notified = 0
  for (const workspace of workspaces) {
    const { data, error } = await admin.rpc('workspace_operational_slos', {
      target_workspace_id: workspace.id,
    })
    if (error) throw error
    const slo = data as OperationalSlo
    const { data: previous, error: stateReadError } = await admin
      .from('operational_alert_state')
      .select('status,fingerprint,last_notified_at')
      .eq('workspace_id', workspace.id)
      .maybeSingle()
    if (stateReadError) throw stateReadError

    const notify = shouldNotifyOperationalAlert(slo, previous)
    if (notify) {
      const response = await fetch(alertUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event:
            slo.overall === 'pass'
              ? 'walchat_slo_recovered'
              : 'walchat_slo_alert',
          workspaceId: workspace.id,
          severity: slo.overall,
          generatedAt: slo.generatedAt,
          services: slo.services,
        }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error(`alert_webhook_http_${response.status}`)
      notified += 1
    }

    const now = new Date().toISOString()
    const { error: stateWriteError } = await admin
      .from('operational_alert_state')
      .upsert({
        workspace_id: workspace.id,
        status: slo.overall,
        fingerprint: operationalAlertFingerprint(slo),
        last_notified_at: notify ? now : (previous?.last_notified_at ?? null),
        updated_at: now,
      })
    if (stateWriteError) throw stateWriteError
  }
  return { checked: workspaces.length, notified }
}
