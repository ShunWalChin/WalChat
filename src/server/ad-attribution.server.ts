/** Persistência server-only de atribuição publicitária, sem IP bruto. */
import '@tanstack/react-start/server-only'
import { normalizeAdAttribution } from '../lib/ad-attribution'
import type { AdAttribution } from '../lib/ad-attribution'
import { getSupabaseAdmin } from './supabase-admin.server'

function requireAdmin() {
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('Supabase administrativo indisponível.')
  return admin
}

export function attributionFromLeadPayload(payload: Record<string, unknown>) {
  const nested =
    payload.tracking &&
    typeof payload.tracking === 'object' &&
    !Array.isArray(payload.tracking)
      ? payload.tracking
      : payload.attribution &&
          typeof payload.attribution === 'object' &&
          !Array.isArray(payload.attribution)
        ? payload.attribution
        : payload
  return normalizeAdAttribution(nested)
}

function hasAttribution(value: AdAttribution) {
  return Boolean(
    value.gclid ||
    value.gbraid ||
    value.wbraid ||
    value.fbclid ||
    value.fbc ||
    value.fbp ||
    value.ctwaClid ||
    value.ctwaSourceId ||
    value.utmSource ||
    value.utmMedium ||
    value.utmCampaign,
  )
}

/**
 * Mantém identificadores first-touch e atualiza contexto/UTMs do último toque.
 * O contato é revalidado no tenant antes do upsert feito com service_role.
 */
export async function saveContactAdAttribution(input: {
  workspaceId: string
  contactId: string
  attribution: unknown
}) {
  const next = normalizeAdAttribution(input.attribution)
  if (!hasAttribution(next)) return { saved: false }
  const admin = requireAdmin()
  const contact = await admin
    .from('contacts')
    .select('id')
    .eq('id', input.contactId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (contact.error) throw contact.error
  if (!contact.data) throw new Error('contact_attribution_tenant_mismatch')
  const existing = await admin
    .from('contact_ad_attributions')
    .select('*')
    .eq('contact_id', input.contactId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (existing.error) throw existing.error
  const current = existing.data
  const touchAt = Number.isFinite(Date.parse(next.capturedAt ?? ''))
    ? new Date(next.capturedAt as string).toISOString()
    : new Date().toISOString()
  const row = {
    contact_id: input.contactId,
    workspace_id: input.workspaceId,
    gclid: current?.gclid ?? next.gclid ?? null,
    gbraid: current?.gbraid ?? next.gbraid ?? null,
    wbraid: current?.wbraid ?? next.wbraid ?? null,
    fbclid: current?.fbclid ?? next.fbclid ?? null,
    fbc: current?.fbc ?? next.fbc ?? null,
    fbp: current?.fbp ?? next.fbp ?? null,
    ctwa_clid: current?.ctwa_clid ?? next.ctwaClid ?? null,
    ctwa_source_id: current?.ctwa_source_id ?? next.ctwaSourceId ?? null,
    ctwa_source_url: current?.ctwa_source_url ?? next.ctwaSourceUrl ?? null,
    ctwa_source_type: current?.ctwa_source_type ?? next.ctwaSourceType ?? null,
    ctwa_headline: current?.ctwa_headline ?? next.ctwaHeadline ?? null,
    ctwa_body: current?.ctwa_body ?? next.ctwaBody ?? null,
    ctwa_media_type: current?.ctwa_media_type ?? next.ctwaMediaType ?? null,
    ctwa_waba_id: current?.ctwa_waba_id ?? next.ctwaWabaId ?? null,
    ctwa_received_at:
      current?.ctwa_received_at ??
      (next.ctwaClid || next.ctwaSourceId ? touchAt : null),
    utm_source: next.utmSource ?? current?.utm_source ?? null,
    utm_medium: next.utmMedium ?? current?.utm_medium ?? null,
    utm_campaign: next.utmCampaign ?? current?.utm_campaign ?? null,
    utm_content: next.utmContent ?? current?.utm_content ?? null,
    utm_term: next.utmTerm ?? current?.utm_term ?? null,
    landing_url: next.landingUrl ?? current?.landing_url ?? null,
    referrer_url: next.referrerUrl ?? current?.referrer_url ?? null,
    client_user_agent:
      next.clientUserAgent ?? current?.client_user_agent ?? null,
    ad_user_data_consent:
      next.adUserDataConsent === 'unknown'
        ? (current?.ad_user_data_consent ?? 'unknown')
        : next.adUserDataConsent,
    first_touch_at: current?.first_touch_at ?? touchAt,
    last_touch_at: touchAt,
    expires_at: new Date(Date.parse(touchAt) + 90 * 86_400_000).toISOString(),
  }
  const { error } = await admin
    .from('contact_ad_attributions')
    .upsert(row, { onConflict: 'contact_id' })
  if (error) throw error
  return { saved: true }
}
