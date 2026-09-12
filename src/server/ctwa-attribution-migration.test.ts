import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260905113000_ctwa_attribution.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('migration CTWA', () => {
  it.each([
    'ctwa_clid',
    'ctwa_source_id',
    'ctwa_source_url',
    'ctwa_source_type',
    'ctwa_headline',
    'ctwa_body',
    'ctwa_media_type',
    'ctwa_waba_id',
    'ctwa_received_at',
  ])('adiciona e limita %s', (column) => {
    expect(migration).toContain(`add column if not exists ${column}`)
  })

  it('preserva o primeiro clique CTWA e mantém o acesso server-only', () => {
    expect(migration).toContain(
      'new.ctwa_clid := coalesce(old.ctwa_clid, new.ctwa_clid)',
    )
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })

  it('habilita a origem Meta business_messaging', () => {
    expect(migration).toContain("'business_messaging'")
  })
})
