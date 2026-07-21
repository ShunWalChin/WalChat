/** Smoke autenticado das APIs que sustentam Configurações, Agentes e Inbox. */
import { createClient } from '@supabase/supabase-js'

const appUrl = process.env.SMOKE_APP_URL ?? 'http://127.0.0.1:3001'
const supabaseUrl = process.env.SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_ANON_KEY
const authEmail = process.env.SMOKE_AUTH_EMAIL ?? 'demo@walchat.local'
const authPassword = process.env.SMOKE_AUTH_PASSWORD ?? 'wal123'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const client = createClient(supabaseUrl, publishableKey)
const login = await client.auth.signInWithPassword({
  email: authEmail,
  password: authPassword,
})
assert(
  !login.error && login.data.session,
  `Login falhou: ${login.error?.message}`,
)

const authorization = `Bearer ${login.data.session.access_token}`
async function requestJson(path, init = {}) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  assert(
    response.ok,
    `${path} falhou (${response.status}): ${JSON.stringify(payload)}`,
  )
  return payload
}

const unauthorized = await fetch(`${appUrl}/api/integrations/meta/status`)
assert(unauthorized.status === 401, 'Status Meta deve exigir autenticação.')

const [meta, ai, agents, inbox, triggers] = await Promise.all([
  requestJson('/api/integrations/meta/status'),
  requestJson('/api/ai/settings'),
  requestJson('/api/ai/agents'),
  requestJson('/api/inbox'),
  requestJson('/api/triggers'),
])

assert(Array.isArray(meta.requiredScopes), 'Status Meta sem scopes.')
assert(Array.isArray(meta.webhookFields), 'Status Meta sem campos de webhook.')
assert(ai.settings?.provider, 'Configuração de IA ausente.')
assert(Array.isArray(agents.agents), 'Lista de agentes inválida.')
assert(Array.isArray(inbox.conversations), 'Inbox inválida.')
assert(Array.isArray(triggers.triggers), 'Lista de gatilhos inválida.')

let suggestion = 'sem-agente'
if (agents.agents.length > 0) {
  const result = await requestJson('/api/ai/suggest', {
    method: 'POST',
    body: JSON.stringify({
      agentId: agents.agents[0].id,
      history: [{ role: 'user', content: 'Como funciona o Wal Chat?' }],
    }),
  })
  assert(result.suggestion?.endsWith('Responda PARAR'), 'IA sem opt-out.')
  suggestion = result.provider
}

console.log(
  JSON.stringify(
    {
      privateApiAuth: 'ok',
      metaStatus: 'ok',
      aiSettings: 'ok',
      agents: agents.agents.length,
      aiSuggestion: suggestion,
      inbox: 'ok',
      triggers: 'ok',
    },
    null,
    2,
  ),
)
