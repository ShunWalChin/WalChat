/** Normaliza mensagens/status do WhatsApp e alimenta Inbox e automações. */
import '@tanstack/react-start/server-only'
import { suggestInstagramReply } from './ai.server'
import { isOptOutKeyword } from './compliance'
import { assertRateLimit } from './rate-limit.server'
import { getSupabaseAdmin } from './supabase-admin.server'

type WhatsAppContact = {
  wa_id?: string
  profile?: { name?: string }
}
type WhatsAppMessage = {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  image?: { id?: string; caption?: string }
  audio?: { id?: string }
  video?: { id?: string; caption?: string }
  document?: { id?: string; caption?: string; filename?: string }
  sticker?: { id?: string }
  button?: { text?: string; payload?: string }
  interactive?: {
    type?: string
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string; description?: string }
  }
  location?: { latitude?: number; longitude?: number; name?: string }
  contacts?: unknown[]
  reaction?: { message_id?: string; emoji?: string }
}
type WhatsAppStatus = {
  id?: string
  status?: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted'
  timestamp?: string
  recipient_id?: string
  errors?: Array<{ code?: number }>
}
type WhatsAppValue = {
  messaging_product?: string
  metadata?: { phone_number_id?: string; display_phone_number?: string }
  contacts?: WhatsAppContact[]
  messages?: WhatsAppMessage[]
  statuses?: WhatsAppStatus[]
}
type WhatsAppWebhook = {
  object?: string
  entry?: Array<{
    id?: string
    changes?: Array<{ field?: string; value?: WhatsAppValue }>
  }>
}
type IngestionResult = {
  contact_id: string
  interaction_id: string
  conversation_id: string
  interaction_inserted: boolean
  contact_ai_enabled: boolean
}

export async function processWhatsAppWebhook(
  payload: WhatsAppWebhook,
  metaEventKey: string,
) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return { processed: 0, statuses: 0, demo: true }
  const startedAt = Date.now()
  const { error: processingError } = await supabase
    .from('webhook_events')
    .update({
      status: 'processing',
      processing_started_at: new Date(startedAt).toISOString(),
      last_attempt_at: new Date(startedAt).toISOString(),
    })
    .eq('meta_event_key', metaEventKey)
  if (processingError) throw processingError

  let processed = 0
  let statuses = 0
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value ?? {}
      const phoneNumberId = value.metadata?.phone_number_id
      if (!phoneNumberId) continue
      const { data: account, error: accountError } = await supabase
        .from('whatsapp_accounts')
        .select('id,workspace_id')
        .eq('phone_number_id', phoneNumberId)
        .eq('waba_id', entry.id ?? '')
        .eq('status', 'connected')
        .maybeSingle()
      if (accountError) throw accountError
      if (!account) continue

      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue
        await applyWhatsAppDeliveryStatus({
          supabase,
          workspaceId: account.workspace_id,
          providerMessageId: status.id,
          status: status.status,
          errorCode: status.errors?.[0]?.code,
        })
        statuses++
      }

      const profileByWaId = new Map(
        (value.contacts ?? [])
          .filter((contact) => contact.wa_id)
          .map((contact) => [contact.wa_id as string, contact.profile?.name]),
      )
      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue
        const normalized = normalizeWhatsAppMessage(message)
        const receivedAt = whatsappTimestamp(message.timestamp)
        const { data: ingestion, error: ingestionError } = await supabase
          .rpc('ingest_whatsapp_inbound', {
            target_workspace_id: account.workspace_id,
            target_account_id: account.id,
            sender_id: message.from,
            sender_name: profileByWaId.get(message.from) ?? null,
            sender_phone: message.from,
            event_id: message.id,
            event_text: normalized.text,
            event_type: normalized.type,
            event_media_url: normalized.mediaId
              ? `/api/integrations/meta/whatsapp/media/${encodeURIComponent(normalized.mediaId)}`
              : null,
            event_raw: message,
            received_at: receivedAt,
          })
          .single()
        if (ingestionError) throw ingestionError
        if (!ingestion) throw new Error('ingest_whatsapp_inbound_empty')
        const ingested = ingestion as IngestionResult
        if (isOptOutKeyword(normalized.text)) {
          await supabase
            .from('contacts')
            .update({
              opted_out_at: new Date().toISOString(),
              ai_enabled: false,
            })
            .eq('workspace_id', account.workspace_id)
            .eq('id', ingested.contact_id)
        } else if (ingested.interaction_inserted) {
          const triggered = await scheduleWhatsAppTrigger({
            supabase,
            workspaceId: account.workspace_id,
            accountId: account.id,
            contactId: ingested.contact_id,
            interactionId: ingested.interaction_id,
            senderId: message.from,
            text: normalized.text,
          })
          if (!triggered && ingested.contact_ai_enabled)
            await maybeScheduleWhatsAppAgent({
              supabase,
              workspaceId: account.workspace_id,
              accountId: account.id,
              contactId: ingested.contact_id,
              interactionId: ingested.interaction_id,
              conversationId: ingested.conversation_id,
              senderId: message.from,
            })
        }
        processed++
      }
    }
  }

  const { error: completedError } = await supabase
    .from('webhook_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      last_error: null,
    })
    .eq('meta_event_key', metaEventKey)
  if (completedError) throw completedError
  return { processed, statuses, demo: false }
}

export function normalizeWhatsAppMessage(message: WhatsAppMessage) {
  const type = message.type ?? 'unknown'
  const media =
    message.image ??
    message.audio ??
    message.video ??
    message.document ??
    message.sticker
  const text =
    message.text?.body ??
    message.image?.caption ??
    message.video?.caption ??
    message.document?.caption ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    message.location?.name ??
    message.reaction?.emoji ??
    (type === 'contacts' ? '[Contato compartilhado]' : '')
  return {
    type,
    text,
    mediaId: media?.id ?? null,
  }
}

function whatsappTimestamp(value?: string) {
  const seconds = Number(value)
  const date = Number.isFinite(seconds) ? new Date(seconds * 1_000) : new Date()
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date().toISOString()
}

async function applyWhatsAppDeliveryStatus(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  providerMessageId: string
  status: NonNullable<WhatsAppStatus['status']>
  errorCode?: number
}) {
  const messageStatus =
    input.status === 'deleted'
      ? null
      : input.status === 'failed'
        ? 'failed'
        : input.status
  if (!messageStatus) return
  const { error } = await input.supabase.rpc('apply_whatsapp_delivery_status', {
    target_workspace_id: input.workspaceId,
    target_provider_message_id: input.providerMessageId,
    target_status: messageStatus,
    target_error_code: input.errorCode
      ? `whatsapp_status_${input.errorCode}`
      : null,
  })
  if (error) throw error
}

async function scheduleWhatsAppTrigger(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  accountId: string
  contactId: string
  interactionId: string
  senderId: string
  text: string
}) {
  if (!input.text.trim()) return false
  const { data: triggers, error } = await input.supabase
    .from('triggers')
    .select(
      'id,keyword,match_mode,response_text,sequence_id,cooldown_hours,auto_tag_id,booking_page_id',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('source', 'whatsapp')
    .eq('is_active', true)
    .order('created_at')
  if (error) throw error
  const normalized = input.text.trim().toLocaleLowerCase('pt-BR')
  for (const trigger of triggers) {
    const keyword = String(trigger.keyword).toLocaleLowerCase('pt-BR')
    if (!(
      (trigger.match_mode === 'exact' && normalized === keyword) ||
      (trigger.match_mode === 'contains' && normalized.includes(keyword))
    ))
      continue
    const { data: cooldown, error: cooldownError } = await input.supabase
      .from('trigger_cooldowns')
      .select('last_fired_at')
      .eq('trigger_id', trigger.id)
      .eq('contact_id', input.contactId)
      .maybeSingle()
    if (cooldownError) throw cooldownError
    if (
      cooldown &&
      Date.now() - new Date(cooldown.last_fired_at).getTime() <
        trigger.cooldown_hours * 3_600_000
    )
      continue

    const { data: run, error: runError } = await input.supabase
      .from('automation_runs')
      .upsert(
        {
          workspace_id: input.workspaceId,
          trigger_id: trigger.id,
          contact_id: input.contactId,
          interaction_id: input.interactionId,
          source: 'whatsapp',
          status: 'matched',
          metadata: { platform: 'whatsapp' },
        },
        { onConflict: 'trigger_id,interaction_id' },
      )
      .select('id,status,scheduled_job_id')
      .single()
    if (runError) throw runError
    if (run.status !== 'matched') return true
    await input.supabase.from('trigger_cooldowns').upsert(
      {
        workspace_id: input.workspaceId,
        trigger_id: trigger.id,
        contact_id: input.contactId,
        last_fired_at: new Date().toISOString(),
      },
      { onConflict: 'trigger_id,contact_id' },
    )
    if (trigger.auto_tag_id)
      await input.supabase.from('contact_tags').upsert(
        {
          workspace_id: input.workspaceId,
          contact_id: input.contactId,
          tag_id: trigger.auto_tag_id,
          source: 'trigger',
          metadata: { triggerId: trigger.id, platform: 'whatsapp' },
        },
        { onConflict: 'contact_id,tag_id' },
      )

    let scheduledJobId: string | null = null
    if (trigger.sequence_id) {
      const { data: enrollment, error: enrollmentError } = await input.supabase
        .from('sequence_enrollments')
        .upsert(
          {
            workspace_id: input.workspaceId,
            sequence_id: trigger.sequence_id,
            contact_id: input.contactId,
            trigger_id: trigger.id,
            source_interaction_id: input.interactionId,
            next_run_at: new Date().toISOString(),
          },
          { onConflict: 'trigger_id,source_interaction_id' },
        )
        .select('id')
        .single()
      if (enrollmentError) throw enrollmentError
      const { data: job, error: jobError } = await input.supabase
        .from('scheduled_jobs')
        .upsert(
          {
            workspace_id: input.workspaceId,
            kind: 'sequence_step',
            dedupe_key: `automation:${run.id}:step:0`,
            payload: {
              platform: 'whatsapp',
              whatsappAccountId: input.accountId,
              senderId: input.senderId,
              enrollmentId: enrollment.id,
              position: 0,
              triggerId: trigger.id,
              automationRunId: run.id,
              bookingPageId: trigger.booking_page_id,
            },
            run_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,dedupe_key' },
        )
        .select('id')
        .single()
      if (jobError) throw jobError
      scheduledJobId = job.id
    } else if (trigger.response_text) {
      const { data: job, error: jobError } = await input.supabase
        .from('scheduled_jobs')
        .upsert(
          {
            workspace_id: input.workspaceId,
            kind: 'sequence_step',
            dedupe_key: `automation:${run.id}:response`,
            payload: {
              platform: 'whatsapp',
              whatsappAccountId: input.accountId,
              senderId: input.senderId,
              contactId: input.contactId,
              responseText: trigger.response_text,
              triggerId: trigger.id,
              automationRunId: run.id,
              bookingPageId: trigger.booking_page_id,
            },
            run_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,dedupe_key' },
        )
        .select('id')
        .single()
      if (jobError) throw jobError
      scheduledJobId = job.id
    }
    await input.supabase
      .from('automation_runs')
      .update({ status: 'scheduled', scheduled_job_id: scheduledJobId })
      .eq('id', run.id)
    return true
  }
  return false
}

async function maybeScheduleWhatsAppAgent(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  accountId: string
  contactId: string
  interactionId: string
  conversationId: string
  senderId: string
}) {
  const { data: runtime, error: runtimeError } = await input.supabase
    .from('workspace_runtime_settings')
    .select('autonomous_ai_enabled')
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (runtimeError) throw runtimeError
  if (!runtime?.autonomous_ai_enabled) return
  const { data: agent, error: agentError } = await input.supabase
    .from('ai_agents')
    .select('id,fallback_to_copilot')
    .eq('workspace_id', input.workspaceId)
    .eq('mode', 'autonomous')
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (agentError) throw agentError
  if (!agent) return
  const { data: recent } = await input.supabase
    .from('interactions_log')
    .select('direction,message_text')
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .not('message_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10)
  try {
    await assertRateLimit({
      namespace: 'autonomous-ai',
      identity: input.workspaceId,
      limit: 45,
      windowSeconds: 60,
    })
    const result = await suggestInstagramReply({
      workspaceId: input.workspaceId,
      agentId: agent.id,
      history: (recent ?? []).reverse().map((item) => ({
        role:
          item.direction === 'inbound'
            ? ('user' as const)
            : ('assistant' as const),
        content: String(item.message_text),
      })),
      safetyIdentifier: `${input.workspaceId}:${input.contactId}`,
    })
    const { error: jobError } = await input.supabase
      .from('scheduled_jobs')
      .upsert(
        {
          workspace_id: input.workspaceId,
          kind: 'sequence_step',
          dedupe_key: `ai-agent:${agent.id}:interaction:${input.interactionId}`,
          payload: {
            platform: 'whatsapp',
            whatsappAccountId: input.accountId,
            contactId: input.contactId,
            responseText: result.suggestion,
            senderId: input.senderId,
            aiGenerated: true,
            agentId: agent.id,
          },
          run_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,dedupe_key', ignoreDuplicates: true },
      )
    if (jobError) throw jobError
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'whatsapp_autonomous_agent_failed',
        error: error instanceof Error ? error.name : 'unknown_error',
      }),
    )
    if (agent.fallback_to_copilot)
      await input.supabase
        .from('conversations')
        .update({ category: 'ia_off' })
        .eq('workspace_id', input.workspaceId)
        .eq('id', input.conversationId)
  }
}
