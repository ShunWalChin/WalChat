/**
 * Servidor Node de produção para o bundle TanStack Start.
 * Converte HTTP do Node para Fetch API e serve assets versionados.
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import app from '../dist/server/server.js'
import { buildSecurityHeaders } from './security-headers.mjs'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
const fallbackOrigin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const clientRoot = path.resolve(scriptDirectory, '../dist/client')

// O proxy informa host/protocolo externos; reconstruí-los mantém URLs e redirects corretos.
const server = http.createServer(async (incoming, outgoing) => {
  try {
    // APP_ORIGIN é a autoridade canônica; Host/X-Forwarded-Host do cliente não
    // participam de redirects, cookies ou URLs absolutas.
    const url = new URL(incoming.url ?? '/', fallbackOrigin)
    const method = incoming.method ?? 'GET'
    const suppliedRequestId = firstHeader(incoming.headers['x-request-id'])
    const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedRequestId ?? '')
      ? suppliedRequestId
      : randomUUID()
    outgoing.setHeader('x-request-id', requestId)
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const securityHeaders = buildSecurityHeaders({
      isHttps: url.protocol === 'https:',
      supabaseUrl: process.env.VITE_SUPABASE_URL,
    })
    for (const [name, value] of Object.entries(securityHeaders))
      outgoing.setHeader(name, value)

    if (
      (method === 'GET' || method === 'HEAD') &&
      (await serveStatic(url.pathname, method, outgoing))
    ) {
      return
    }

    const headers = toWebHeaders(incoming.headers)
    headers.set('x-request-id', requestId)
    const request = new Request(url, {
      method,
      headers,
      body: hasBody ? Readable.toWeb(incoming) : undefined,
      duplex: hasBody ? 'half' : undefined,
    })

    const response = await app.fetch(request)
    outgoing.statusCode = response.status
    outgoing.statusMessage = response.statusText

    for (const [name, value] of response.headers) {
      if (name.toLowerCase() !== 'set-cookie') outgoing.setHeader(name, value)
    }
    const cookies = response.headers.getSetCookie?.() ?? []
    if (cookies.length) outgoing.setHeader('set-cookie', cookies)

    if (!response.body || method === 'HEAD') {
      outgoing.end()
      return
    }

    Readable.fromWeb(response.body).pipe(outgoing)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'http_request_failed',
        error: error instanceof Error ? error.name : 'unknown_error',
      }),
    )
    if (!outgoing.headersSent) {
      outgoing.statusCode = 500
      outgoing.setHeader('content-type', 'application/json; charset=utf-8')
    }
    outgoing.end(JSON.stringify({ error: 'internal_server_error' }))
  }
})

server.requestTimeout = 60_000
server.headersTimeout = 15_000
server.keepAliveTimeout = 5_000
server.maxHeadersCount = 100
server.maxRequestsPerSocket = 1_000
server.on('clientError', (_error, socket) => {
  if (socket.writable)
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
})

server.listen(port, host, () => {
  console.log(JSON.stringify({ event: 'server_started', host, port }))
})

/** Encerra conexões com prazo máximo para o orquestrador não deixar o processo preso. */
function shutdown(signal) {
  console.log(JSON.stringify({ event: 'server_stopping', signal }))
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

/** Normaliza headers que podem chegar como string, lista ou valor separado por vírgula. */
function firstHeader(value) {
  if (Array.isArray(value)) return value[0]
  return value?.split(',')[0]?.trim()
}

/** Adapta `IncomingHttpHeaders` ao objeto padrão `Headers`. */
function toWebHeaders(headers) {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item)
    } else if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

/**
 * Serve somente arquivos contidos em `dist/client`; a checagem de prefixo
 * impede que uma URL com `..` leia arquivos fora da raiz pública.
 */
async function serveStatic(pathname, method, response) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return false
  }

  const relativePath = decoded.replace(/^\/+/, '')
  if (!relativePath) return false

  const filePath = path.resolve(clientRoot, relativePath)
  if (
    filePath !== clientRoot &&
    !filePath.startsWith(`${clientRoot}${path.sep}`)
  )
    return false

  let fileStats
  try {
    fileStats = await stat(filePath)
  } catch {
    return false
  }
  if (!fileStats.isFile()) return false

  response.statusCode = 200
  response.setHeader('content-type', contentTypeFor(filePath))
  response.setHeader('content-length', fileStats.size)
  response.setHeader(
    'cache-control',
    decoded.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600',
  )

  if (method === 'HEAD') {
    response.end()
    return true
  }

  createReadStream(filePath).pipe(response)
  return true
}

/** Mapeamento mínimo de MIME types necessários pelo bundle e assets públicos. */
function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.map': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.txt': 'text/plain; charset=utf-8',
      '.webmanifest': 'application/manifest+json',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    }[extension] ?? 'application/octet-stream'
  )
}
