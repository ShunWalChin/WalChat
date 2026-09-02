/**
 * Monitor da cota por APLICATIVO da Graph API da Meta.
 *
 * O teto de 700/h que já existe em `rate-limit.server.ts` é por conta do
 * Instagram. Existe um segundo teto, por aplicativo, compartilhado por todas as
 * contas conectadas — e é ele que derruba tudo de uma vez: um cliente com
 * campanha viral consome a cota do app, e todos os outros workspaces passam a
 * receber 429 sem ter enviado nada. Nenhum limite por conta protege contra isso,
 * porque cada conta pode estar bem abaixo do próprio limite.
 *
 * A Meta informa esse consumo em headers de toda resposta da Graph API. Como
 * são headers e não corpo, ler custa praticamente nada; o que custa é não ler.
 */
import '@tanstack/react-start/server-only'
import { esperarRedis, redisCompartilhado } from './rate-limit.server'

/** Acima disto o despacho pausa em vez de continuar até o 429 da Meta. */
export const META_APP_USAGE_PAUSE_PERCENT = 80

/** A leitura vale por uma janela curta: sem chamada recente, não há o que saber. */
const META_APP_USAGE_TTL_SECONDS = 15 * 60

const CHAVE_USO = 'walchat:meta:app-usage'
const CHAVE_ESPERA = 'walchat:meta:app-usage:regain-at'

export type MetaAppUsage = {
  callCount: number
  totalCputime: number
  totalTime: number
  /** O maior dos três: é o que a Meta usa para decidir o bloqueio. */
  peak: number
}

function percentual(valor: unknown) {
  const numero = Number(valor)
  return Number.isFinite(numero) && numero >= 0 ? Math.min(numero, 1000) : 0
}

/**
 * `X-App-Usage` traz `{"call_count":28,"total_cputime":15,"total_time":15}`,
 * cada campo em percentual do teto do aplicativo.
 */
export function parseAppUsageHeader(raw: string | null): MetaAppUsage | null {
  if (!raw) return null
  // `unknown` e não `Record`: `JSON.parse('null')` devolve null e
  // `JSON.parse('[1]')` devolve array. Afirmar o tipo aqui faria as guardas
  // abaixo parecerem mortas para o TypeScript sem deixarem de ser necessárias.
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null
  const registro = payload as Record<string, unknown>
  const callCount = percentual(registro.call_count)
  const totalCputime = percentual(registro.total_cputime)
  const totalTime = percentual(registro.total_time)
  return {
    callCount,
    totalCputime,
    totalTime,
    peak: Math.max(callCount, totalCputime, totalTime),
  }
}

/**
 * `X-Business-Use-Case-Usage` é por business e vem como
 * `{"<id>":[{"call_count":10,...,"estimated_time_to_regain_access":3}]}`.
 *
 * O campo de reconquista é o mais útil de todos: quando a Meta já bloqueou, ele
 * diz em minutos quanto falta. Adivinhar esse tempo com backoff cego é o que
 * transforma um bloqueio de 3 minutos numa hora parada.
 */
export function parseBusinessUseCaseHeader(raw: string | null) {
  if (!raw) return null
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null
  let peak = 0
  let regainMinutes = 0
  for (const entradas of Object.values(payload as Record<string, unknown>)) {
    if (!Array.isArray(entradas)) continue
    for (const item of entradas as Array<unknown>) {
      if (!item || typeof item !== 'object') continue
      const entrada = item as Record<string, unknown>
      peak = Math.max(
        peak,
        percentual(entrada.call_count),
        percentual(entrada.total_cputime),
        percentual(entrada.total_time),
      )
      regainMinutes = Math.max(
        regainMinutes,
        percentual(entrada.estimated_time_to_regain_access),
      )
    }
  }
  return { peak, regainMinutes }
}

/**
 * Registra o consumo lido de uma resposta da Graph API.
 *
 * Nunca lança: é observação passiva no caminho de toda chamada Meta. Uma falha
 * aqui não pode derrubar a chamada que estava dando certo.
 */
export async function recordMetaAppUsage(response: Response) {
  try {
    const app = parseAppUsageHeader(response.headers.get('x-app-usage'))
    const business = parseBusinessUseCaseHeader(
      response.headers.get('x-business-use-case-usage'),
    )
    const peak = Math.max(app?.peak ?? 0, business?.peak ?? 0)
    if (!app && !business) return

    const client = redisCompartilhado()
    if (!client) return
    if (client.status !== 'ready') await esperarRedis(client)

    await client.set(CHAVE_USO, String(peak), 'EX', META_APP_USAGE_TTL_SECONDS)

    // A Meta só manda tempo de reconquista quando já bloqueou. Guardar o
    // instante de liberação evita tentar de novo no escuro.
    if (business?.regainMinutes) {
      const liberaEm = Date.now() + business.regainMinutes * 60_000
      await client.set(
        CHAVE_ESPERA,
        String(liberaEm),
        'EX',
        Math.ceil(business.regainMinutes * 60) + 60,
      )
    }
  } catch {
    // Observação passiva: perder uma leitura não justifica falhar a chamada.
  }
}

/** Último percentual conhecido, ou nulo quando não houve chamada recente. */
export async function readMetaAppUsage() {
  const client = redisCompartilhado()
  if (!client) return null
  try {
    if (client.status !== 'ready') await esperarRedis(client)
    const raw = await client.get(CHAVE_USO)
    return raw === null ? null : Number(raw)
  } catch {
    return null
  }
}

export class MetaAppQuotaPausedError extends Error {
  readonly retryAfterMs: number
  readonly usagePercent: number

  constructor(usagePercent: number, retryAfterMs: number) {
    super('meta_app_quota_paused')
    this.name = 'MetaAppQuotaPausedError'
    this.usagePercent = usagePercent
    this.retryAfterMs = Math.max(1_000, retryAfterMs)
  }
}

/**
 * Pausa o despacho quando a cota do aplicativo está perto do teto.
 *
 * Falha ABERTA de propósito, ao contrário do resto do módulo de limites. A
 * reserva por conta em `reserveInstagramPrivateReplySlot` já falha fechada
 * quando o Redis some, então o envio nem chega aqui nesse cenário — e fazer
 * esta checagem falhar fechada só acrescentaria um segundo caminho de 503 sem
 * proteger nada a mais.
 */
export async function assertMetaAppQuotaHeadroom() {
  const client = redisCompartilhado()
  if (!client) return

  try {
    if (client.status !== 'ready') await esperarRedis(client)

    const bloqueadoAte = await client.get(CHAVE_ESPERA)
    if (bloqueadoAte) {
      const restante = Number(bloqueadoAte) - Date.now()
      if (restante > 0) throw new MetaAppQuotaPausedError(100, restante)
    }

    const raw = await client.get(CHAVE_USO)
    if (raw === null) return
    const uso = Number(raw)
    if (!Number.isFinite(uso) || uso < META_APP_USAGE_PAUSE_PERCENT) return

    // Sem tempo informado pela Meta, espera proporcional ao quanto passou do
    // limiar: quanto mais perto do teto, mais longa a pausa.
    const excedente = Math.min(uso, 100) - META_APP_USAGE_PAUSE_PERCENT
    const janela = 100 - META_APP_USAGE_PAUSE_PERCENT
    const espera = 30_000 + Math.round((excedente / janela) * 270_000)
    throw new MetaAppQuotaPausedError(uso, espera)
  } catch (error) {
    if (error instanceof MetaAppQuotaPausedError) throw error
    // Falha de Redis não pausa o despacho — ver o comentário acima.
  }
}
