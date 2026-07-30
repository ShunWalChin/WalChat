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
let temporaryAgentId
let temporaryDocumentId
try {
  const createdAgent = await requestJson('/api/ai/agents', {
    method: 'POST',
    body: JSON.stringify({
      name: `Agente Smoke ${Date.now()}`,
      persona: 'Especialista de teste que responde de forma curta e objetiva.',
      mode: 'copilot',
      tone: 'direto e cordial',
      isActive: true,
      providerOverride: null,
      modelOverride: null,
      maxReplyChars: 300,
      fallbackToCopilot: true,
    }),
  })
  temporaryAgentId = createdAgent.id
  await requestJson('/api/ai/agents', {
    method: 'PATCH',
    body: JSON.stringify({ id: temporaryAgentId, tone: 'cordial e conciso' }),
  })
  const createdDocument = await requestJson('/api/ai/knowledge', {
    method: 'POST',
    body: JSON.stringify({
      agentId: temporaryAgentId,
      title: 'Base temporária do smoke',
      content: 'O Wal Chat centraliza atendimento e automação do Instagram.',
    }),
  })
  temporaryDocumentId = createdDocument.id
  const documents = await requestJson(
    `/api/ai/knowledge?agentId=${encodeURIComponent(temporaryAgentId)}`,
  )
  assert(
    documents.documents.length === 1,
    'CRUD da base de conhecimento falhou.',
  )

  const result = await requestJson('/api/ai/suggest', {
    method: 'POST',
    body: JSON.stringify({
      agentId: temporaryAgentId,
      history: [{ role: 'user', content: 'Como funciona o Wal Chat?' }],
    }),
  })
  assert(result.suggestion?.endsWith('Responda PARAR'), 'IA sem opt-out.')
  suggestion = result.provider
} finally {
  if (temporaryDocumentId)
    await requestJson('/api/ai/knowledge', {
      method: 'DELETE',
      body: JSON.stringify({ id: temporaryDocumentId }),
    })
  if (temporaryAgentId)
    await requestJson('/api/ai/agents', {
      method: 'DELETE',
      body: JSON.stringify({ id: temporaryAgentId }),
    })
}

console.log(
  JSON.stringify(
    {
      privateApiAuth: 'ok',
      metaStatus: 'ok',
      aiSettings: 'ok',
      agentsCrud: 'ok',
      knowledgeCrud: 'ok',
      aiSuggestion: suggestion,
      inbox: 'ok',
      triggers: 'ok',
    },
    null,
    2,
  ),
)
