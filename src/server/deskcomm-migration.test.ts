import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260828090000_deskcomm_capabilities_core.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('migration de capacidades CRM e IA', () => {
  it.each([
    'crm_pipelines',
    'crm_stages',
    'crm_leads',
    'message_templates',
    'attendant_availability',
    'webhook_sources',
    'webhook_lead_captures',
    'ai_agent_versions',
    'ai_budgets',
    'ai_routers',
    'org_memory_entries',
    'agent_cases',
    'ai_execution_log',
    'api_audit_log',
  ])('cria e protege %s', (table) => {
    expect(migration).toContain(`create table if not exists public.${table}`)
    expect(migration).toContain(`'${table}'`)
  })

  it('mantém mutações exclusivas do backend e leitura por workspace', () => {
    expect(migration).toContain('enable row level security')
    expect(migration).toContain('public.is_workspace_member(workspace_id)')
    expect(migration).toContain(
      'revoke insert, update, delete on public.%I from authenticated',
    )
    expect(migration).toContain(
      'grant select, insert, update, delete on public.%I to service_role',
    )
  })

  it('protege concorrência de leads e repetição de webhooks', () => {
    expect(migration).toContain('crm_leads_lock_version_trigger')
    expect(migration).toContain('unique (source_id, dedupe_key)')
  })
})
