/** Captura first-touch para Google Ads/Meta sem cookies próprios invasivos. */
export type AdUserDataConsent = 'unknown' | 'granted' | 'denied'

export type AdAttribution = {
  gclid?: string
  gbraid?: string
  wbraid?: string
  fbclid?: string
  fbc?: string
  fbp?: string
  ctwaClid?: string
  ctwaSourceId?: string
  ctwaSourceUrl?: string
  ctwaSourceType?: string
  ctwaHeadline?: string
  ctwaBody?: string
  ctwaMediaType?: string
  ctwaWabaId?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  landingUrl?: string
  referrerUrl?: string
  clientUserAgent?: string
  adUserDataConsent?: AdUserDataConsent
  capturedAt?: string
}

const STORAGE_KEY = 'walchat_ad_attribution_v1'
const TTL_MS = 90 * 86_400_000
const AD_QUERY_KEYS = new Set([
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
])

function bounded(value: unknown, max: number) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, max) : undefined
}

function cookieValue(cookieHeader: string, name: string) {
  return cookieHeader
    .split(/;\s*/)
    .map((item) => item.split('='))
    .find(([key]) => key === name)
    ?.slice(1)
    .join('=')
}

function safeUrl(value: unknown, includeAdQuery: boolean) {
  const raw = bounded(value, 2048)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    url.username = ''
    url.password = ''
    url.hash = ''
    const entries = includeAdQuery
      ? Array.from(url.searchParams.entries()).filter(([key]) =>
          AD_QUERY_KEYS.has(key),
        )
      : []
    url.search = ''
    for (const [key, entryValue] of entries)
      url.searchParams.append(key, entryValue.slice(0, 512))
    return url.toString().slice(0, 2048)
  } catch {
    return undefined
  }
}

export function normalizeAdAttribution(value: unknown): AdAttribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const consent = bounded(
    source.adUserDataConsent ?? source.ad_user_data_consent,
    16,
  )
  return {
    gclid: bounded(source.gclid, 512),
    gbraid: bounded(source.gbraid, 512),
    wbraid: bounded(source.wbraid, 512),
    fbclid: bounded(source.fbclid, 512),
    fbc: bounded(source.fbc ?? source._fbc, 512),
    fbp: bounded(source.fbp ?? source._fbp, 512),
    ctwaClid: bounded(source.ctwaClid ?? source.ctwa_clid, 512),
    ctwaSourceId: bounded(
      source.ctwaSourceId ??
        source.ctwa_source_id ??
        source.sourceAdId ??
        source.source_ad_id ??
        source.source_id,
      128,
    ),
    ctwaSourceUrl: safeUrl(
      source.ctwaSourceUrl ?? source.ctwa_source_url ?? source.source_url,
      false,
    ),
    ctwaSourceType: bounded(
      source.ctwaSourceType ?? source.ctwa_source_type ?? source.source_type,
      32,
    ),
    ctwaHeadline: bounded(
      source.ctwaHeadline ?? source.ctwa_headline ?? source.headline,
      500,
    ),
    ctwaBody: bounded(source.ctwaBody ?? source.ctwa_body ?? source.body, 1000),
    ctwaMediaType: bounded(
      source.ctwaMediaType ?? source.ctwa_media_type ?? source.media_type,
      32,
    ),
    ctwaWabaId: bounded(
      source.ctwaWabaId ?? source.ctwa_waba_id ?? source.waba_id,
      80,
    ),
    utmSource: bounded(source.utmSource ?? source.utm_source, 160),
    utmMedium: bounded(source.utmMedium ?? source.utm_medium, 160),
    utmCampaign: bounded(source.utmCampaign ?? source.utm_campaign, 240),
    utmContent: bounded(source.utmContent ?? source.utm_content, 240),
    utmTerm: bounded(source.utmTerm ?? source.utm_term, 240),
    landingUrl: safeUrl(source.landingUrl ?? source.landing_url, true),
    referrerUrl: safeUrl(source.referrerUrl ?? source.referrer_url, false),
    clientUserAgent: bounded(
      source.clientUserAgent ?? source.client_user_agent,
      512,
    ),
    adUserDataConsent: ['granted', 'denied'].includes(consent ?? '')
      ? (consent as AdUserDataConsent)
      : 'unknown',
    capturedAt: bounded(source.capturedAt ?? source.captured_at, 40),
  }
}

export function attributionFromBrowser(
  locationHref: string,
  referrer: string,
  cookieHeader: string,
  userAgent: string,
): AdAttribution {
  const url = new URL(locationHref)
  const query = Object.fromEntries(url.searchParams)
  return normalizeAdAttribution({
    ...query,
    fbc: cookieValue(cookieHeader, '_fbc'),
    fbp: cookieValue(cookieHeader, '_fbp'),
    landingUrl: `${url.origin}${url.pathname}${url.search}`,
    referrerUrl: referrer,
    clientUserAgent: userAgent,
    capturedAt: new Date().toISOString(),
  })
}

export function readAdAttribution(): AdAttribution {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = normalizeAdAttribution(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}'),
    )
    const captured = Date.parse(parsed.capturedAt ?? '')
    if (!Number.isFinite(captured) || Date.now() - captured > TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY)
      return {}
    }
    return parsed
  } catch {
    return {}
  }
}

export function captureAdAttribution(consent?: AdUserDataConsent) {
  if (typeof window === 'undefined') return {}
  const previous = readAdAttribution()
  const current = attributionFromBrowser(
    window.location.href,
    document.referrer,
    document.cookie,
    navigator.userAgent,
  )
  const merged: AdAttribution = {
    ...previous,
    gclid: previous.gclid ?? current.gclid,
    gbraid: previous.gbraid ?? current.gbraid,
    wbraid: previous.wbraid ?? current.wbraid,
    fbclid: previous.fbclid ?? current.fbclid,
    fbc: previous.fbc ?? current.fbc,
    fbp: previous.fbp ?? current.fbp,
    ctwaClid: previous.ctwaClid ?? current.ctwaClid,
    ctwaSourceId: previous.ctwaSourceId ?? current.ctwaSourceId,
    ctwaSourceUrl: previous.ctwaSourceUrl ?? current.ctwaSourceUrl,
    ctwaSourceType: previous.ctwaSourceType ?? current.ctwaSourceType,
    ctwaHeadline: previous.ctwaHeadline ?? current.ctwaHeadline,
    ctwaBody: previous.ctwaBody ?? current.ctwaBody,
    ctwaMediaType: previous.ctwaMediaType ?? current.ctwaMediaType,
    ctwaWabaId: previous.ctwaWabaId ?? current.ctwaWabaId,
    utmSource: current.utmSource ?? previous.utmSource,
    utmMedium: current.utmMedium ?? previous.utmMedium,
    utmCampaign: current.utmCampaign ?? previous.utmCampaign,
    utmContent: current.utmContent ?? previous.utmContent,
    utmTerm: current.utmTerm ?? previous.utmTerm,
    landingUrl: current.landingUrl ?? previous.landingUrl,
    referrerUrl: current.referrerUrl ?? previous.referrerUrl,
    clientUserAgent: current.clientUserAgent ?? previous.clientUserAgent,
    capturedAt: previous.capturedAt ?? current.capturedAt,
    adUserDataConsent: consent ?? previous.adUserDataConsent ?? 'unknown',
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // A reserva continua funcional quando storage está bloqueado pelo browser.
  }
  return merged
}
