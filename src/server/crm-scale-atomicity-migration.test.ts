import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260903120000_crm_scale_atomicity.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('migration de escala e atomicidade do CRM', () => {
  it.each([
    'crm_list_leads',
    'crm_pipeline_summary',
    'crm_create_lead_command',
    'crm_update_lead_command',
    'crm_add_activity_command',
    'crm_bulk_update_leads',
    'crm_import_leads_command',
    'crm_create_pipeline_command',
    'crm_reorder_stages_command',
  ])('cria a função %s e limita sua execução ao service role', (name) => {
    expect(migration).toContain(`function public.${name}(`)
    expect(migration).toContain(`revoke all on function public.${name}`)
    expect(migration).toContain(`grant execute on function public.${name}`)
  })

  it('pagina no banco e nunca permite lotes ilimitados', () => {
    expect(migration).toContain('target_page_size > 200')
    expect(migration).toContain('offset (target_page - 1) * target_page_size')
    expect(migration).toContain('limit target_page_size')
  })

  it('mantém lead, atividade e auditoria na mesma transação', () => {
    const createCommand = migration.slice(
      migration.indexOf('function public.crm_create_lead_command'),
      migration.indexOf('function public.crm_update_lead_command'),
    )
    expect(createCommand).toContain('insert into public.crm_leads')
    expect(createCommand).toContain('insert into public.crm_lead_activities')
    expect(createCommand).toContain('insert into public.api_audit_log')
  })

  it('faz a atualização com lock otimista antes de registrar efeitos', () => {
    expect(migration).toContain('for update;')
    expect(migration).toContain("raise exception 'crm_lead_conflict'")
    expect(migration).toContain('and lock_version = expected_lock_version')
  })

  it('cria e reordena o desenho do pipeline em comandos transacionais', () => {
    const pipelineCommand = migration.slice(
      migration.indexOf('function public.crm_create_pipeline_command'),
      migration.indexOf('function public.crm_reorder_stages_command'),
    )
    expect(pipelineCommand).toContain('insert into public.crm_pipelines')
    expect(pipelineCommand).toContain('insert into public.crm_stages')
    expect(pipelineCommand).toContain('insert into public.api_audit_log')
    expect(migration).toContain('from unnest(target_stage_ids) with ordinality')
  })
})
