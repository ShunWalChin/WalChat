/**
 * Identidade de rede usada como chave dos rate limits anônimos.
 *
 * Headers de IP são texto enviado pelo cliente até que um proxy confiável os
 * reescreva. Este módulo só aceita o header que o Nginx do Wal Chat realmente
 * define (`X-Real-IP`) e, como âncora secundária, o último salto de
 * `X-Forwarded-For` — que é o valor acrescentado pelo próprio proxy. Headers de
 * CDNs que não estão no caminho (`CF-Connecting-IP` e afins) são ignorados:
 * confiar neles daria a qualquer cliente um balde de rate limit novo por
 * requisição.
 */
import '@tanstack/react-start/server-only'
import { isIP } from 'node:net'

/** Deployments atrás de uma CDN declaram o header dela explicitamente. */
function trustedCdnHeader() {
  const configured = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase()
  return configured && configured !== 'x-real-ip' ? configured : null
}

function normalizeIp(value: string | null | undefined) {
  const candidate = value?.trim()
  if (!candidate) return null
  // IPv6 chega entre colchetes em algumas configurações de proxy.
  const unwrapped = candidate.replace(/^\[|\]$/g, '')
  // `::ffff:203.0.113.7` e `203.0.113.7:51234` devem colapsar no mesmo balde.
  const mapped = unwrapped.toLowerCase().startsWith('::ffff:')
    ? unwrapped.slice(7)
    : unwrapped
  if (isIP(mapped)) return mapped
  const withoutPort = mapped.replace(/:\d{1,5}$/, '')
  return isIP(withoutPort) ? withoutPort : null
}

export function requestIdentity(request: Request) {
  const cdnHeader = trustedCdnHeader()
  if (cdnHeader) {
    const fromCdn = normalizeIp(request.headers.get(cdnHeader))
    if (fromCdn) return fromCdn
  }

  const realIp = normalizeIp(request.headers.get('x-real-ip'))
  if (realIp) return realIp

  // `$proxy_add_x_forwarded_for` acrescenta o peer real ao final da cadeia;
  // tudo antes disso foi enviado pelo cliente e não pode ser confiado.
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',')
    const lastHop = normalizeIp(hops[hops.length - 1])
    if (lastHop) return lastHop
  }

  return 'unknown-client'
}
