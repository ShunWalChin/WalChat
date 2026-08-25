/** Política HTTP central aplicada pelo servidor Node também atrás de proxy reverso. */
export function buildSecurityHeaders({
  isHttps,
  supabaseUrl,
  analyticsEnabled = false,
  mapsEnabled = false,
  scriptNonce,
}) {
  const connectSources = new Set(["'self'"])
  // Com nonce por requisicao o script inline do SSR e permitido nominalmente e
  // um script injetado por XSS deixa de ser. Sem nonce a politica cai no
  // 'unsafe-inline' historico, que nao distingue os dois.
  const scriptSources = new Set([
    "'self'",
    scriptNonce ? `'nonce-${scriptNonce}'` : "'unsafe-inline'",
    'https://connect.facebook.net',
  ])
  const frameSources = new Set([
    "'self'",
    'https://www.facebook.com',
    'https://web.facebook.com',
  ])
  const supabaseOrigin = parseHttpOrigin(supabaseUrl)
  if (supabaseOrigin) {
    connectSources.add(supabaseOrigin)
    connectSources.add(supabaseOrigin.replace(/^http/, 'ws'))
  }
  if (analyticsEnabled) {
    scriptSources.add('https://www.googletagmanager.com')
    connectSources.add('https://www.google-analytics.com')
    connectSources.add('https://region1.google-analytics.com')
  }
  if (mapsEnabled) {
    frameSources.add('https://www.google.com')
    frameSources.add('https://maps.google.com')
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${[...scriptSources].join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    `connect-src ${[...connectSources].join(' ')} https://graph.facebook.com https://www.facebook.com`,
    `frame-src ${[...frameSources].join(' ')}`,
    "manifest-src 'self'",
  ]
  if (isHttps) directives.push('upgrade-insecure-requests')

  return {
    'content-security-policy': directives.join('; '),
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'cross-origin-resource-policy': 'same-origin',
    'x-dns-prefetch-control': 'off',
    'origin-agent-cluster': '?1',
    ...(isHttps
      ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
      : {}),
  }
}

function parseHttpOrigin(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null
  } catch {
    return null
  }
}
