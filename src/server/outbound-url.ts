/**
 * Proteção contra SSRF nos destinos escolhidos pelo operador.
 *
 * Tanto a conexão n8n quanto o nó de requisição externa deixam um usuário do
 * produto apontar o servidor para uma URL arbitrária. Uma segunda cópia desta
 * lógica seria uma segunda chance de esquecer uma faixa reservada, então as
 * duas passam por aqui.
 */
import '@tanstack/react-start/server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class OutboundUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboundUrlError'
  }
}

/** Faixas que nunca são um destino público legítimo. */
export function isPublicAddress(address: string): boolean {
  if (address.includes(':')) {
    const normalized = address.toLowerCase()
    if (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    )
      return false
    // fe80::/10, link-local.
    if (/^fe[89ab]/.test(normalized)) return false
    if (normalized.startsWith('::ffff:'))
      return isPublicAddress(normalized.slice(7))
    return true
  }
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return false
  const [a, b, c] = octets
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    // 192.0.0.0/24 carrega o NAT64 e outras atribuições de protocolo.
    (a === 192 && b === 0 && c === 0) ||
    // TEST-NET-1/2/3 nunca são destinos reais e costumam mapear para lab interno.
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/**
 * Confirma que o host resolve apenas para endereços públicos.
 *
 * A resolução acontece aqui e a conexão acontece depois, então uma janela de
 * rebinding DNS continua aberta — fechá-la exige fixar o IP no agente HTTP.
 * A checagem ainda vale: ela barra o caso comum, que é apontar direto para
 * `169.254.169.254` ou para um host interno.
 */
export async function assertPublicHost(
  hostname: string,
  resolveHost: typeof lookup = lookup,
) {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname))
      throw new OutboundUrlError(
        'O destino não pode usar IP privado ou reservado.',
      )
    return
  }
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await resolveHost(hostname, { all: true, verbatim: true })
  } catch {
    throw new OutboundUrlError('O host do destino não pôde ser resolvido.')
  }
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new OutboundUrlError('O host resolve para uma rede não permitida.')
}

/**
 * Valida uma URL de saída completa: esquema, ausência de credenciais e destino
 * público. Devolve a URL normalizada.
 */
export async function assertSafeOutboundUrl(
  value: string,
  options: { resolveHost?: typeof lookup; allowQuery?: boolean } = {},
) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new OutboundUrlError('URL inválida.')
  }
  if (url.username || url.password || url.hash)
    throw new OutboundUrlError(
      'A URL não pode conter credenciais ou fragmento.',
    )
  if (url.protocol !== 'https:')
    throw new OutboundUrlError('Use HTTPS no destino.')
  await assertPublicHost(url.hostname.toLowerCase(), options.resolveHost)
  if (!options.allowQuery) url.search = ''
  return url
}
