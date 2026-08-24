#!/usr/bin/env node

/**
 * Smoke de produção sem efeitos externos: testa HTTPS, readiness live,
 * challenges e assinatura HMAC com payloads vazios. Nenhuma mensagem,
 * publicação, contato ou evento de agenda é criado por este script.
 */

import { createHmac } from 'node:crypto'

const baseUrl = (
  process.env.WAL_CHAT_BASE_URL || 'https://wal-chat.64.181.178.125.nip.io'
).replace(/\/$/, '')

function required(name, fallbackName) {
  const value = process.env[name] || (fallbackName && process.env[fallbackName])
  if (!value) throw new Error(`Configuração obrigatória ausente: ${name}`)
  return value
}

async function jsonResponse(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

function signature(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

async function verifyChallenge(path, verifyToken) {
  const challenge = 'walchat-live-safe-smoke'
  const url = new URL(`${baseUrl}${path}`)
  url.searchParams.set('hub.mode', 'subscribe')
  url.searchParams.set('hub.verify_token', verifyToken)
  url.searchParams.set('hub.challenge', challenge)
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  return response.status === 200 && (await response.text()) === challenge
}

async function verifySignedPost(path, body, secret) {
  const invalid = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}`,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const valid = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature(body, secret),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  return {
    invalidRejected: invalid.status === 401,
    validAccepted: valid.status === 200,
    invalidStatus: invalid.status,
    validStatus: valid.status,
  }
}

const instagramSecret = required('META_INSTAGRAM_APP_SECRET', 'META_APP_SECRET')
const instagramVerifyToken = required(
  'META_INSTAGRAM_VERIFY_TOKEN',
  'META_VERIFY_TOKEN',
)
const whatsappSecret = required('META_WHATSAPP_APP_SECRET', 'META_APP_SECRET')
const whatsappVerifyToken = required(
  'META_WHATSAPP_VERIFY_TOKEN',
  'META_VERIFY_TOKEN',
)

const [{ response: health }, { response: readyResponse, payload: ready }] =
  await Promise.all([jsonResponse('/api/health'), jsonResponse('/api/ready')])

const instagramBody = JSON.stringify({ object: 'instagram', entry: [] })
const whatsappBody = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [],
})

const [instagramChallenge, whatsappChallenge, instagramPost, whatsappPost] =
  await Promise.all([
    verifyChallenge('/api/public/webhooks/instagram', instagramVerifyToken),
    verifyChallenge('/api/public/webhooks/whatsapp', whatsappVerifyToken),
    verifySignedPost(
      '/api/public/webhooks/instagram',
      instagramBody,
      instagramSecret,
    ),
    verifySignedPost(
      '/api/public/webhooks/whatsapp',
      whatsappBody,
      whatsappSecret,
    ),
  ])

const checks = {
  health: health.status === 200,
  readiness: readyResponse.status === 200 && ready.ok === true,
  liveMode: ready.mode === 'live',
  dependenciesUp:
    ready.checks?.supabase?.status === 'up' &&
    ready.checks?.redis?.status === 'up',
  instagramChallenge,
  whatsappChallenge,
  instagramSignature: instagramPost,
  whatsappSignature: whatsappPost,
}
const ok = Boolean(
  checks.health &&
  checks.readiness &&
  checks.liveMode &&
  checks.dependenciesUp &&
  checks.instagramChallenge &&
  checks.whatsappChallenge &&
  checks.instagramSignature.invalidRejected &&
  checks.instagramSignature.validAccepted &&
  checks.whatsappSignature.invalidRejected &&
  checks.whatsappSignature.validAccepted,
)

console.log(JSON.stringify({ ok, checks }, null, 2))
process.exitCode = ok ? 0 : 1
