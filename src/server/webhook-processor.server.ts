/** Normaliza webhooks Meta, persiste a inbox e agenda automações elegíveis. */
import '@tanstack/react-start/server-only'
import { suggestInstagramReply } from './ai.server'
import { extractReferral } from './growth-links'
import { refFromIcebreakerPayload } from './icebreakers'
import { isFirstContact } from './welcome-domain'
import {
  resumeAutomationAfterReply,
  startAutomationExecution,
} from './automation-engine.server'
import { isOptOutKeyword } from './compliance'
import { getServerEnv } from './env.server'
import { assertRateLimit } from './rate-limit.server'
import { getSupabaseAdmin } from './supabase-admin.server'
import { assignConversationByRouting } from './team-routing.server'

type MetaChange = { field?: string; value?: Record<string, unknown> }
type MetaMessage = {
  mid?: string
  text?: string
  is_echo?: boolean
  is_self?: boolean
  attachments?: Array<{ type?: string; payload?: Record<string, unknown> }>
  reply_to?: { story?: Record<string, unknown> }
}
type MetaMessaging = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: MetaMessage
  postback?: { mid?: string; title?: string; payload?: string }
  reaction?: Record<string, unknown>
}
type MetaEntry = {
  id?: string
  time?: number
  field?: string
  value?: Record<string, unknown>
  changes?: MetaChange[]
  messaging?: MetaMessaging[]
}
type MetaWebhook = { object?: string; entry?: MetaEntry[] }
type InboundIngestionResult = {
  contact_id: string
  interaction_id: string
  conversation_id: string | null
  interaction_inserted: boolean
  contact_ai_enabled: boolean
}

/** Processa formatos `messaging`, `changes` e o formato direto `field/value`. */
export async function processInstagramWebhook(
  payload: MetaWebhook,
  metaEventKey: string,
) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return { processed: 0, demo: true }
  const startedAt = Date.now()
  const { error: processingStatusError } = await supabase
    .from('webhook_events')
    .update({
      status: 'processing',
      processing_started_at: new Date(startedAt).toISOString(),
      last_attempt_at: new Date(startedAt).toISOString(),
    })
    .eq('meta_event_key', metaEventKey)
  if (processingStatusError) throw processingStatusError
  let processed = 0

  for (const entry of payload.entry ?? []) {
    const { data: account } = await supabase
      .from('instagram_accounts')
      .select('id,workspace_id')
      .eq('instagram_user_id', entry.id ?? '')
      .eq('status', 'connected')
      .maybeSingle()
    if (!account) continue

    for (const event of entry.messaging ?? []) {
      // Ecos de mensagens enviadas pela própria conta nunca abrem janela nem disparam IA.
      if (event.message?.is_echo || event.message?.is_self) continue
      // Recibos de leitura/seen não são mensagens do contato e não abrem a janela de 24h.
      if (!event.message && !event.postback && !event.reaction) continue
      const senderId = event.sender?.id
      if (!senderId || senderId === entry.id) continue
      const inboundText = event.message?.text ?? event.postback?.title ?? ''
      const metaId =
        event.message?.mid ??
        event.postback?.mid ??
        `${metaEventKey}:messaging:${processed}`
      const channel = event.postback
        ? 'postback'
        : event.reaction
          ? 'reaction'
          : isStoryInteraction(event.message)
            ? 'story_reply'
            : 'dm'
      await ingestInbound({
        supabase,
        workspaceId: account.workspace_id,
        accountId: account.id,
        senderId,
        metaId,
        text: inboundText,
        channel,
        raw: event,
        timestamp: event.timestamp,
      })
      processed++
    }

    const changes = [...(entry.changes ?? [])]
    if (entry.field) changes.push({ field: entry.field, value: entry.value })
    for (const change of changes) {
      if (
        ![
          'comments',
          'live_comments',
          'mentions',
          'message_reactions',
        ].includes(change.field ?? '')
      )
        continue
      const value = change.value ?? {}
      const sender = value.from as
        | { id?: string; username?: string; self_ig_scoped_id?: string }
        | undefined
      const username = sender?.username
      const senderId =
        sender?.id ??
        sender?.self_ig_scoped_id ??
        (username ? `username:${username}` : null)
      if (!senderId || senderId === entry.id) continue
      await ingestInbound({
        supabase,
        workspaceId: account.workspace_id,
        accountId: account.id,
        senderId,
        username,
        metaId: String(value.id ?? `${metaEventKey}:change:${processed}`),
        text: String(value.text ?? ''),
        channel:
          change.field === 'comments' || change.field === 'live_comments'
            ? 'comment'
            : change.field === 'mentions'
              ? 'mention'
              : 'reaction',
        raw: value,
        timestamp: entry.time,
      })
      processed++
    }
  }

  const { error: eventStatusError } = await supabase
    .from('webhook_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      last_error: null,
    })
    .eq('meta_event_key', metaEventKey)
  if (eventStatusError) throw eventStatusError
  return { processed, demo: false }
}

function isStoryInteraction(message?: MetaMessage) {
  return Boolean(
    message?.reply_to?.story ||
    message?.attachments?.some(
      (attachment) => attachment.type === 'story_mention',
    ),
  )
}

function metaTimestamp(value?: number) {
  if (!value) return new Date().toISOString()
  const milliseconds = value > 10_000_000_000 ? value : value * 1_000
  const date = new Date(milliseconds)
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date().toISOString()
}

/** Apenas ações conversacionais do contato abrem ou renovam a janela padrão. */
export function opensMessagingWindow(channel: string) {
  return ['dm', 'story_reply', 'postback'].includes(channel)
}

/** Upsert do CRM, conversa, interação e mensagem com as mesmas chaves idempotentes. */
async function ingestInbound(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  accountId: string
  senderId: string
  username?: string
  metaId: string
  text: string
  channel: string
  raw: unknown
  timestamp?: number
}) {
  const receivedAt = metaTimestamp(input.timestamp)
  const { data: ingestion, error: ingestionError } = await input.supabase
    .rpc('ingest_instagram_inbound', {
      target_workspace_id: input.workspaceId,
      target_account_id: input.accountId,
      sender_id: input.senderId,
      sender_username: input.username ?? null,
      event_id: input.metaId,
      event_channel: input.channel,
      event_text: input.text,
      event_raw: input.raw,
      received_at: receivedAt,
      opens_window: opensMessagingWindow(input.channel),
    })
    .single()
  if (ingestionError) throw ingestionError
  if (!ingestion) throw new Error('ingest_instagram_inbound_empty')
  const ingested = ingestion as InboundIngestionResult

  // Reações são telemetria da mensagem existente, não uma nova conversa na inbox.
  if (input.channel === 'reaction' || !ingested.conversation_id) return

  if (ingested.interaction_inserted)
    await assignConversationByRouting({
      admin: input.supabase,
      workspaceId: input.workspaceId,
      conversationId: ingested.conversation_id,
    })

  // A origem vem antes de tudo: ela decide qual fluxo recebe a pessoa e precisa
  // ficar no contato mesmo que nenhuma automação dispare depois.
  const growthRef =
    extractReferral(input.raw) ??
    refFromIcebreakerPayload(postbackPayload(input.raw))
  const growthLink = growthRef
    ? await registerGrowthVisit({
        supabase: input.supabase,
        workspaceId: input.workspaceId,
        contactId: ingested.contact_id,
        ref: growthRef,
      })
    : null

  // Um fluxo parado esperando resposta tem precedência: a pessoa está no meio
  // de um menu ou de uma pergunta e disparar um gatilho novo aqui atropelaria a
  // conversa em andamento.
  const resumed = await resumeAutomationAfterReply(
    {
      workspaceId: input.workspaceId,
      contactId: ingested.contact_id,
      text: input.text,
      payload: postbackPayload(input.raw),
    },
    input.supabase,
  )
  if (resumed.handled) return

  const scheduledByTrigger = await matchAndScheduleTrigger({
    ...input,
    contactId: ingested.contact_id,
    interactionId: ingested.interaction_id,
    receivedAt,
    growthLink,
  })
  if (!scheduledByTrigger && ingested.contact_ai_enabled)
    await maybeScheduleAutonomousAgent({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      contactId: ingested.contact_id,
      interactionId: ingested.interaction_id,
      conversationId: ingested.conversation_id,
      senderId: input.senderId,
      channel: input.channel,
    })
}

/**
 * Lê o payload do botão dentro do evento bruto da Meta.
 *
 * Quick reply e postback chegam em lugares diferentes do mesmo evento, e o
 * corpo é dado externo — daí a leitura defensiva em vez de um cast.
 */
function postbackPayload(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const event = raw as {
    postback?: { payload?: unknown }
    message?: { quick_reply?: { payload?: unknown } }
  }
  const fromPostback = event.postback?.payload
  if (typeof fromPostback === 'string') return fromPostback
  const fromQuickReply = event.message?.quick_reply?.payload
  return typeof fromQuickReply === 'string' ? fromQuickReply : null
}

/**
 * Registra a visita vinda de um link de captação.
 *
 * A contagem é de visitas atribuídas, não de cliques: a Meta só avisa quando a
 * conversa abre, então quem toca no link e desiste antes de enviar não aparece.
 * Chamar isso de "cliques" na tela seria prometer uma métrica que não existe.
 *
 * A origem só é gravada no contato quando ele ainda não tem uma. A primeira
 * origem é a que explica como a pessoa chegou; sobrescrever a cada visita
 * transformaria o campo em "última campanha que ela tocou", que é outra coisa.
 */
async function registerGrowthVisit(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  contactId: string
  ref: string
}) {
  const { data: link, error } = await input.supabase
    .from('growth_links')
    .select('id,ref,flow_id,is_active,clicks')
    .eq('workspace_id', input.workspaceId)
    .eq('ref', input.ref)
    .maybeSingle()
  if (error) throw error

  // Link desconhecido ainda merece registro no contato: pode ser uma campanha
  // criada fora do produto, e perder a origem seria perder a informação.
  const { error: contactError } = await input.supabase
    .from('contacts')
    .update({ growth_ref: input.ref })
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.contactId)
    .is('growth_ref', null)
  if (contactError) throw contactError

  if (!link) return null

  const { error: countError } = await input.supabase
    .from('growth_links')
    .update({
      clicks: link.clicks + 1,
      last_click_at: new Date().toISOString(),
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', link.id)
  if (countError) throw countError

  return link.is_active ? link : null
}

/**
 * Busca a saudação de boas-vindas quando esta é a primeira vez que a pessoa fala.
 *
 * A contagem exclui a interação atual de propósito: incluí-la faria todo contato
 * parecer veterano e a saudação nunca dispararia. O `neq` no id da interação é o
 * que garante isso mesmo com a linha já gravada pela ingestão.
 *
 * Devolve `null` — e não lança — quando não é primeiro contato, porque a ausência
 * de saudação é o caminho normal, não um erro.
 */
async function matchWelcomeTrigger(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  contactId: string
  interactionId: string
  channel: string
}) {
  const { data: trigger, error } = await input.supabase
    .from('triggers')
    .select(
      'id,keyword,match_mode,response_text,sequence_id,flow_id,post_id,cooldown_hours,auto_tag_id,booking_page_id,first_contact_channels',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('source', 'first_contact')
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!trigger) return null

  const { count, error: countError } = await input.supabase
    .from('interactions_log')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .eq('direction', 'inbound')
    .neq('id', input.interactionId)
  if (countError) throw countError

  return isFirstContact({
    previousInboundCount: count ?? 0,
    channel: input.channel,
    enabledChannels: trigger.first_contact_channels ?? ['dm'],
  })
    ? trigger
    : null
}

/** Aplica opt-out, match e cooldown; no máximo um gatilho agenda resposta por evento. */
async function matchAndScheduleTrigger(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  accountId: string
  contactId: string
  interactionId: string
  senderId: string
  metaId: string
  text: string
  channel: string
  raw: unknown
  receivedAt: string
  /** Link de captação que trouxe esta pessoa, quando houve um. */
  growthLink?: { id: string; flow_id: string | null } | null
}) {
  const source =
    input.channel === 'comment'
      ? 'comment'
      : input.channel === 'story_reply'
        ? 'story'
        : input.channel === 'dm' || input.channel === 'postback'
          ? 'dm'
          : null
  if (!source || !input.text) return false
  if (isOptOutKeyword(input.text)) {
    await input.supabase
      .from('contacts')
      .update({ opted_out_at: new Date().toISOString(), ai_enabled: false })
      .eq('id', input.contactId)
      .eq('workspace_id', input.workspaceId)
    return true
  }

  // A saudação de primeiro contato concorre com os gatilhos por palavra, e vem
  // antes: quem chega agora precisa ser recebido antes de cair numa automação
  // que pressupõe conversa em andamento.
  // Link com fluxo próprio ganha da saudação geral: quem veio por uma campanha
  // específica precisa receber a mensagem daquela campanha, não a genérica.
  const welcome = input.growthLink?.flow_id
    ? {
        id: `growth:${input.growthLink.id}`,
        keyword: null,
        match_mode: 'contains' as const,
        response_text: null,
        sequence_id: null,
        flow_id: input.growthLink.flow_id,
        post_id: null,
        cooldown_hours: 168,
        auto_tag_id: null,
        booking_page_id: null,
      }
    : await matchWelcomeTrigger({
        supabase: input.supabase,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        interactionId: input.interactionId,
        channel: input.channel,
      })

  const { data: keywordTriggers, error } = await input.supabase
    .from('triggers')
    .select(
      'id,keyword,match_mode,response_text,sequence_id,flow_id,post_id,cooldown_hours,auto_tag_id,booking_page_id',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('source', source)
    .eq('is_active', true)
    .order('created_at')
  if (error) throw error
  const triggers = welcome ? [welcome, ...keywordTriggers] : keywordTriggers
  const configuredPostIds = Array.from(
    new Set(triggers.map((trigger) => trigger.post_id).filter(Boolean)),
  ) as string[]
  const { data: configuredPosts, error: postsError } = configuredPostIds.length
    ? await input.supabase
        .from('posts_cache')
        .select('id,instagram_media_id')
        .eq('workspace_id', input.workspaceId)
        .in('id', configuredPostIds)
    : { data: [], error: null }
  if (postsError) throw postsError
  const instagramMediaByPost = new Map(
    configuredPosts.map((post) => [post.id, post.instagram_media_id]),
  )
  const incomingMediaId = extractInstagramMediaId(input.raw)
  const normalized = input.text.trim().toLocaleLowerCase('pt-BR')
  for (const trigger of triggers) {
    // Gatilho sem palavra é a saudação: ela já foi qualificada por ser o
    // primeiro contato, então não há texto a casar.
    const matches =
      trigger.keyword === null
        ? true
        : trigger.match_mode === 'exact'
          ? normalized === String(trigger.keyword).toLocaleLowerCase('pt-BR')
          : normalized.includes(
              String(trigger.keyword).toLocaleLowerCase('pt-BR'),
            )
    if (!matches) continue
    if (
      trigger.post_id &&
      instagramMediaByPost.get(trigger.post_id) !== incomingMediaId
    )
      continue
    const { data: existingRun, error: existingRunError } = await input.supabase
      .from('automation_runs')
      .select('id,status,scheduled_job_id')
      .eq('trigger_id', trigger.id)
      .eq('interaction_id', input.interactionId)
      .maybeSingle()
    if (existingRunError) throw existingRunError
    // Um retry repara somente runs que pararam em `matched`; qualquer estado
    // posterior já possui uma decisão persistida e não pode ser duplicado.
    if (existingRun && existingRun.status !== 'matched') return true

    if (!existingRun) {
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
    }

    let automationRun = existingRun
    if (!automationRun) {
      const { data, error: runError } = await input.supabase
        .from('automation_runs')
        .upsert(
          {
            workspace_id: input.workspaceId,
            trigger_id: trigger.id,
            contact_id: input.contactId,
            interaction_id: input.interactionId,
            source,
            status: 'matched',
            metadata: {
              instagramMediaId: incomingMediaId,
              metaEventId: input.metaId,
            },
          },
          { onConflict: 'trigger_id,interaction_id' },
        )
        .select('id,status,scheduled_job_id')
        .single()
      if (runError) throw runError
      automationRun = data
    }

    if (source === 'comment' && getServerEnv().DEMO_MODE === 'false') {
      const { data: runtimeSettings, error: settingsError } =
        await input.supabase
          .from('workspace_runtime_settings')
          .select('comment_to_dm_enabled')
          .eq('workspace_id', input.workspaceId)
          .maybeSingle()
      if (settingsError) throw settingsError
      if (!runtimeSettings?.comment_to_dm_enabled) {
        await input.supabase
          .from('automation_runs')
          .update({ status: 'blocked', reason: 'comment_to_dm_disabled' })
          .eq('id', automationRun.id)
        return true
      }
    }

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
          metadata: { triggerId: trigger.id, platform: 'instagram' },
        },
        { onConflict: 'contact_id,tag_id' },
      )

    const commonPayload = {
      senderId: input.senderId,
      instagramCommentId: source === 'comment' ? input.metaId : null,
      commentCreatedAt: source === 'comment' ? input.receivedAt : null,
      triggerId: trigger.id,
      automationRunId: automationRun.id,
      bookingPageId: trigger.booking_page_id,
    }
    let scheduledJobId: string | null = null
    let flowExecutionId: string | null = null
    if (trigger.flow_id) {
      const execution = await startAutomationExecution(
        {
          workspaceId: input.workspaceId,
          flowId: trigger.flow_id,
          contactId: input.contactId,
          platform: 'instagram',
          idempotencyKey: `trigger:${trigger.id}:interaction:${input.interactionId}`,
          triggerId: trigger.id,
          sourceInteractionId: input.interactionId,
          context: commonPayload,
        },
        input.supabase,
      )
      scheduledJobId = execution.jobId
      flowExecutionId = execution.executionId
    } else if (trigger.sequence_id) {
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
      const { data: scheduledJob, error: scheduledJobError } =
        await input.supabase
          .from('scheduled_jobs')
          .upsert(
            {
              workspace_id: input.workspaceId,
              kind: 'sequence_step',
              dedupe_key: `automation:${automationRun.id}:step:0`,
              payload: {
                enrollmentId: enrollment.id,
                position: 0,
                ...commonPayload,
              },
              run_at: new Date().toISOString(),
            },
            { onConflict: 'workspace_id,dedupe_key' },
          )
          .select('id')
          .single()
      if (scheduledJobError) throw scheduledJobError
      scheduledJobId = scheduledJob.id
    } else if (trigger.response_text) {
      const { data: scheduledJob, error: scheduledJobError } =
        await input.supabase
          .from('scheduled_jobs')
          .upsert(
            {
              workspace_id: input.workspaceId,
              kind: 'sequence_step',
              dedupe_key: `automation:${automationRun.id}:response`,
              payload: {
                contactId: input.contactId,
                responseText: trigger.response_text,
                ...commonPayload,
              },
              run_at: new Date().toISOString(),
            },
            { onConflict: 'workspace_id,dedupe_key' },
          )
          .select('id')
          .single()
      if (scheduledJobError) throw scheduledJobError
      scheduledJobId = scheduledJob.id
    }
    await input.supabase
      .from('automation_runs')
      .update({
        status: 'scheduled',
        scheduled_job_id: scheduledJobId,
        flow_execution_id: flowExecutionId,
      })
      .eq('id', automationRun.id)
    return true
  }
  return false
}

function extractInstagramMediaId(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const media = record.media
  if (media && typeof media === 'object' && 'id' in media)
    return String(media.id)
  if (record.media_id) return String(record.media_id)
  return null
}

/** Em modo autônomo a IA apenas prepara um job; compliance e envio ficam no scheduler. */
async function maybeScheduleAutonomousAgent(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  accountId: string
  contactId: string
  interactionId: string
  conversationId: string
  senderId: string
  channel: string
}) {
  if (!['dm', 'story_reply', 'postback'].includes(input.channel)) return
  const { data: runtimeSettings, error: runtimeSettingsError } =
    await input.supabase
      .from('workspace_runtime_settings')
      .select('autonomous_ai_enabled')
      .eq('workspace_id', input.workspaceId)
      .maybeSingle()
  if (runtimeSettingsError) throw runtimeSettingsError
  if (!runtimeSettings?.autonomous_ai_enabled) return
  const { data: agent, error } = await input.supabase
    .from('ai_agents')
    .select('id,fallback_to_copilot')
    .eq('workspace_id', input.workspaceId)
    .eq('mode', 'autonomous')
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!agent) return

  const dedupeKey = `ai-agent:${agent.id}:interaction:${input.interactionId}`
  const { data: existingJob, error: existingJobError } = await input.supabase
    .from('scheduled_jobs')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (existingJobError) throw existingJobError
  if (existingJob) return
  const { data: recent } = await input.supabase
    .from('interactions_log')
    .select('direction,message_text')
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .not('message_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10)
  const history = (recent ?? []).reverse().map((item) => ({
    role:
      item.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
    content: String(item.message_text),
  }))
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
      history,
      safetyIdentifier: `${input.workspaceId}:${input.contactId}`,
    })
    const { error: jobError } = await input.supabase
      .from('scheduled_jobs')
      .upsert(
        {
          workspace_id: input.workspaceId,
          kind: 'sequence_step',
          dedupe_key: dedupeKey,
          payload: {
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
  } catch (agentError) {
    console.error(
      JSON.stringify({
        event: 'autonomous_agent_failed',
        error: agentError instanceof Error ? agentError.name : 'unknown_error',
      }),
    )
    if (agent.fallback_to_copilot)
      await input.supabase
        .from('conversations')
        .update({ category: 'ia_off' })
        .eq('id', input.conversationId)
        .eq('workspace_id', input.workspaceId)
  }
}
