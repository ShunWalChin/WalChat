/** Política HTTP central aplicada pelo servidor Node também atrás de proxy reverso. */
export function buildSecurityHeaders({ isHttps, supabaseUrl }) {
  const connectSources = new Set(["'self'"])
  const supabaseOrigin = parseHttpOrigin(supabaseUrl)
  if (supabaseOrigin) {
    connectSources.add(supabaseOrigin)
    connectSources.add(supabaseOrigin.replace(/^http/, 'ws'))
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://connect.facebook.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    `connect-src ${[...connectSources].join(' ')} https://graph.facebook.com https://www.facebook.com`,
    "frame-src 'self' https://www.facebook.com https://web.facebook.com",
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
    ...(isHttps ? { 'strict-transport-security': 'max-age=31536000' } : {}),
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
