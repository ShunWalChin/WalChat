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
const unauthorizedN8n = await fetch(`${appUrl}/api/integrations/n8n/status`)
assert(unauthorizedN8n.status === 401, 'Status n8n deve exigir autenticação.')

const [
  meta,
  n8n,
  ai,
  agents,
  inbox,
  contacts,
  contactTags,
  dashboard,
  triggers,
  goLive,
  webhooks,
  media,
] = await Promise.all([
  requestJson('/api/integrations/meta/status'),
  requestJson('/api/integrations/n8n/status'),
  requestJson('/api/ai/settings'),
  requestJson('/api/ai/agents'),
  requestJson('/api/inbox'),
  requestJson('/api/contacts'),
  requestJson('/api/contact-tags'),
  requestJson('/api/dashboard'),
  requestJson('/api/triggers'),
  requestJson('/api/operations/go-live'),
  requestJson('/api/operations/webhooks'),
  requestJson('/api/integrations/meta/media'),
])

assert(Array.isArray(meta.requiredScopes), 'Status Meta sem scopes.')
assert(Array.isArray(meta.webhookFields), 'Status Meta sem campos de webhook.')
assert(
  Array.isArray(meta.whatsapp?.requiredScopes),
  'Status WhatsApp sem scopes.',
)
assert(
  typeof n8n.permissions?.canManage === 'boolean',
  'Status n8n sem permissões.',
)
assert(Array.isArray(n8n.recentDeliveries), 'Histórico n8n inválido.')
assert(ai.settings?.provider, 'Configuração de IA ausente.')
assert(Array.isArray(agents.agents), 'Lista de agentes inválida.')
assert(Array.isArray(inbox.conversations), 'Inbox inválida.')
assert(Array.isArray(contacts.contacts), 'CRM multicanal inválido.')
assert(contacts.pagination?.page === 1, 'Paginação do CRM inválida.')
assert(Array.isArray(contacts.members), 'Responsáveis do CRM inválidos.')
assert(Array.isArray(contactTags.tags), 'Catálogo de tags inválido.')
if (contacts.contacts[0]) {
  const contactDetail = await requestJson(
    `/api/contacts/${encodeURIComponent(contacts.contacts[0].id)}`,
  )
  assert(contactDetail.contact?.id, 'Perfil 360º do contato inválido.')
  assert(Array.isArray(contactDetail.notes), 'Notas do contato inválidas.')
  assert(Array.isArray(contactDetail.audit), 'Auditoria do contato inválida.')
}
assert(Array.isArray(dashboard.chart), 'Dashboard multicanal inválido.')
assert(Array.isArray(triggers.triggers), 'Lista de gatilhos inválida.')
assert(Array.isArray(goLive.checks), 'Diagnóstico de Go-Live inválido.')
assert(Array.isArray(webhooks.events), 'Observabilidade de webhooks inválida.')
assert(Array.isArray(media.posts), 'Cache de posts Meta inválido.')

// Exercita o endpoint de runtime somente no estado seguro. O smoke nunca liga
// efeitos externos, mesmo quando executado por engano em um ambiente live.
const safeRuntime = await requestJson('/api/operations/go-live', {
  method: 'PATCH',
  body: JSON.stringify({
    externalSendsEnabled: false,
    commentToDmEnabled: false,
    autonomousAiEnabled: false,
  }),
})
assert(
  safeRuntime.settings?.externalSendsEnabled === false &&
    safeRuntime.settings?.commentToDmEnabled === false &&
    safeRuntime.settings?.autonomousAiEnabled === false,
  'Kill switches não permaneceram desligados.',
)

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
      n8nStatus: 'ok',
      aiSettings: 'ok',
      agentsCrud: 'ok',
      knowledgeCrud: 'ok',
      aiSuggestion: suggestion,
      inbox: 'ok',
      contacts: 'ok',
      contactTags: 'ok',
      contactProfile: contacts.contacts[0] ? 'ok' : 'sem-contatos',
      dashboard: 'ok',
      triggers: 'ok',
      goLive: 'ok',
      goLiveKillSwitches: 'off',
      webhookObservability: 'ok',
      metaMediaCache: 'ok',
    },
    null,
    2,
  ),
)
