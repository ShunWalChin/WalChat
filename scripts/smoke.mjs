/** Teste integrado para Auth, RLS, webhook assinado, fila, worker e scheduler. */
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const appUrl = process.env.SMOKE_APP_URL ?? 'http://127.0.0.1:3001'
const supabaseUrl = process.env.SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_ANON_KEY
const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const instagramSecret =
  process.env.META_INSTAGRAM_APP_SECRET ?? process.env.META_APP_SECRET
const whatsappSecret =
  process.env.META_WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET
const instagramVerifyToken =
  process.env.META_INSTAGRAM_VERIFY_TOKEN ?? process.env.META_VERIFY_TOKEN
const whatsappVerifyToken =
  process.env.META_WHATSAPP_VERIFY_TOKEN ?? process.env.META_VERIFY_TOKEN
const authEmail = process.env.SMOKE_AUTH_EMAIL ?? 'demo@walchat.local'
const authPassword = process.env.SMOKE_AUTH_PASSWORD ?? 'wal123'

/** Falha imediatamente e preserva no log a etapa responsável. */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(instagramSecret, 'Secret do app Instagram ausente no smoke.')
assert(whatsappSecret, 'Secret do app WhatsApp ausente no smoke.')
assert(instagramVerifyToken, 'Verify token Instagram ausente no smoke.')
assert(whatsappVerifyToken, 'Verify token WhatsApp ausente no smoke.')

const healthResponse = await fetch(`${appUrl}/api/health`)
const health = await healthResponse.json()
assert(healthResponse.ok && health.ok, 'Health check falhou.')

const client = createClient(supabaseUrl, publishableKey)
const login = await client.auth.signInWithPassword({
  email: authEmail,
  password: authPassword,
})
assert(
  !login.error && login.data.user,
  `Login local falhou: ${login.error?.message}`,
)
const workspaces = await client.from('workspaces').select('id,name,slug')
assert(
  !workspaces.error && workspaces.data.length === 1,
  `RLS do workspace falhou: ${workspaces.error?.message}`,
)

const anonymous = createClient(supabaseUrl, publishableKey)
const anonContacts = await anonymous.from('contacts').select('id')
assert(Boolean(anonContacts.error), 'Anon não deveria ler contatos.')

const verification = await fetch(
  `${appUrl}/api/public/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(instagramVerifyToken)}&hub.challenge=wal_ok`,
)
assert(
  verification.ok && (await verification.text()) === 'wal_ok',
  'Verificação GET do webhook falhou.',
)
const whatsappVerification = await fetch(
  `${appUrl}/api/public/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(whatsappVerifyToken)}&hub.challenge=wal_wa_ok`,
)
assert(
  whatsappVerification.ok &&
    (await whatsappVerification.text()) === 'wal_wa_ok',
  'Verificação GET do webhook WhatsApp falhou.',
)

// O comentário sintético aciona o gatilho seedado e percorre a fila até o scheduler.
const payload = {
  object: 'instagram',
  entry: [
    {
      id: '17841400000000001',
      changes: [
        {
          field: 'comments',
          value: {
            id: `comment_smoke_${Date.now()}`,
            text: 'quero o guia',
            from: { id: 'ig_webhook_test', username: 'webhook.teste' },
          },
        },
      ],
    },
  ],
}
const rawBody = JSON.stringify(payload)
const signature = `sha256=${createHmac('sha256', instagramSecret).update(rawBody).digest('hex')}`
const invalid = await fetch(`${appUrl}/api/public/webhooks/instagram`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': 'sha256=invalid',
  },
  body: rawBody,
})
assert(invalid.status === 401, 'Webhook deveria recusar assinatura inválida.')
const webhook = await fetch(`${appUrl}/api/public/webhooks/instagram`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': signature,
  },
  body: rawBody,
})
const webhookResult = await webhook.json()
assert(
  webhook.ok && webhookResult.received && webhookResult.backend === 'bullmq',
  `Webhook assinado falhou: ${JSON.stringify(webhookResult)}`,
)
const whatsappPayload = {
  object: 'whatsapp_business_account',
  entry: [],
}
const whatsappRawBody = JSON.stringify(whatsappPayload)
const whatsappSignature = `sha256=${createHmac('sha256', whatsappSecret).update(whatsappRawBody).digest('hex')}`
const whatsappWebhook = await fetch(`${appUrl}/api/public/webhooks/whatsapp`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': whatsappSignature,
  },
  body: whatsappRawBody,
})
const whatsappWebhookResult = await whatsappWebhook.json()
assert(
  whatsappWebhook.ok && whatsappWebhookResult.received,
  `Webhook WhatsApp assinado falhou: ${JSON.stringify(whatsappWebhookResult)}`,
)

await new Promise((resolve) => setTimeout(resolve, 1_500))
const admin = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const contact = await admin
  .from('contacts')
  .select('id')
  .eq('instagram_user_id', 'ig_webhook_test')
  .maybeSingle()
assert(
  !contact.error && contact.data,
  `Worker não ingeriu o contato: ${contact.error?.message}`,
)
const scheduledJobs = await admin.from('scheduled_jobs').select('status')
const triggerRows = await admin
  .from('triggers')
  .select('id,name,source,keyword,is_active')
assert(
  !scheduledJobs.error && scheduledJobs.data.length > 0,
  `Gatilho não agendou a sequência: jobs=${scheduledJobs.data?.length ?? 0}; triggers=${JSON.stringify(triggerRows.data)}; error=${scheduledJobs.error?.message}`,
)
const completedJobs = scheduledJobs.data.filter(
  (job) => job.status === 'completed',
).length

console.log(
  JSON.stringify(
    {
      health: 'ok',
      auth: 'ok',
      rls: 'ok',
      webhookVerification: 'ok',
      webhookSignature: 'ok',
      whatsappWebhook: 'ok',
      queue: webhookResult.backend,
      worker: 'ok',
      scheduler: completedJobs > 0 ? 'ok' : 'pending-next-tick',
    },
    null,
    2,
  ),
)
