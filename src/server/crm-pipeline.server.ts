import '@tanstack/react-start/server-only'
import type { User } from '@supabase/supabase-js'
import { classifyCrmRisk } from './crm-pipeline-contract'
import type { getSupabaseAdmin } from './supabase-admin.server'

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>

export async function writeCrmAudit(input: {
  admin: AdminClient
  workspaceId: string
  user: User
  action: string
  resourceType: string
  resourceId?: string | null
  changes?: Record<string, unknown>
  request?: Request
}) {
  const userAgent = input.request?.headers.get('user-agent')?.slice(0, 500)
  const { error } = await input.admin.from('api_audit_log').insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.user.id,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    changes: input.changes ?? {},
    user_agent: userAgent || null,
  })
  if (error) throw error
}

export async function reconcileCrmRiskStates(input: {
  admin: AdminClient
  workspaceId?: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  let leadQuery = input.admin
    .from('crm_leads')
    .select(
      'id,workspace_id,last_activity_at,next_action_at,crm_stages!inner(expected_duration_hours)',
    )
    .eq('status', 'open')
    .limit(2_000)
  if (input.workspaceId)
    leadQuery = leadQuery.eq('workspace_id', input.workspaceId)

  const { data: leads, error: leadsError } = await leadQuery
  if (leadsError) throw leadsError
  if (!leads.length) return { inspected: 0, changed: 0 }

  const workspaceIds = Array.from(
    new Set(leads.map((lead) => lead.workspace_id)),
  )
  const { data: existing, error: stateError } = await input.admin
    .from('crm_lead_risk_states')
    .select('lead_id,bucket')
    .in('workspace_id', workspaceIds)
    .in(
      'lead_id',
      leads.map((lead) => lead.id),
    )
  if (stateError) throw stateError
  const byLead = new Map(existing.map((state) => [state.lead_id, state.bucket]))

  const rows = leads.flatMap((lead) => {
    const relation = Array.isArray(lead.crm_stages)
      ? lead.crm_stages[0]
      : lead.crm_stages
    const coldHours = Number(relation.expected_duration_hours)
    const risk = classifyCrmRisk({
      lastActivityAt: lead.last_activity_at,
      nextActionAt: lead.next_action_at,
      expectedDurationHours: coldHours,
      now,
    })
    if (byLead.get(lead.id) === risk.bucket) return []
    const baseline = lead.last_activity_at
      ? new Date(lead.last_activity_at)
      : now
    const threshold = new Date(baseline.getTime() + coldHours * 3_600_000)
    const since =
      risk.bucket === 'em_risco' || risk.bucket === 'critico'
        ? threshold
        : baseline
    return [
      {
        lead_id: lead.id,
        workspace_id: lead.workspace_id,
        bucket: risk.bucket,
        since: new Date(Math.min(since.getTime(), now.getTime())).toISOString(),
        detected_at: now.toISOString(),
        cold_hours: coldHours,
        updated_at: now.toISOString(),
      },
    ]
  })

  if (rows.length) {
    const { error } = await input.admin
      .from('crm_lead_risk_states')
      .upsert(rows, { onConflict: 'lead_id' })
    if (error) throw error
  }
  return { inspected: leads.length, changed: rows.length }
}
