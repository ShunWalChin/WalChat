import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260902190000_ad_conversions_oci_capi.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('migration OCI/CAPI', () => {
  it.each([
    'contact_ad_attributions',
    'ad_conversion_connections',
    'ad_conversion_rules',
    'ad_conversion_events',
    'ad_conversion_deliveries',
  ])('cria e protege %s', (table) => {
    expect(migration).toContain(`create table public.${table}`)
    expect(migration).toContain(
      `alter table public.${table} enable row level security`,
    )
    expect(migration).toContain(
      `revoke all on public.${table} from anon, authenticated`,
    )
  })

  it('enfileira uma única conversão por regra e lead', () => {
    expect(migration).toContain('unique (rule_id, lead_id)')
    expect(migration).toContain("'ad_conversion'")
    expect(migration).toContain('on conflict (rule_id, lead_id) do nothing')
    expect(migration).toContain('crm_leads_enqueue_ad_conversion')
  })

  it('não define armazenamento de IP bruto', () => {
    expect(migration).not.toMatch(/client_ip_address|\bip_address\b/)
  })
})
