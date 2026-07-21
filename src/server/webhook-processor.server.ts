/** Normaliza eventos Meta, atualiza o CRM e agenda automações elegíveis. */
import '@tanstack/react-start/server-only'
import { getSupabaseAdmin } from './supabase-admin.server'

type MetaChange = { field?: string; value?: Record<string, unknown> }
type MetaMessaging = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: { mid?: string; text?: string }
  postback?: { mid?: string; title?: string; payload?: string }
  reaction?: Record<string, unknown>
}
type MetaEntry = {
  id?: string
  time?: number
  changes?: MetaChange[]
  messaging?: MetaMessaging[]
}
type MetaWebhook = { object?: string; entry?: MetaEntry[] }

/** Processa os formatos `messaging` e `changes` sem produzir envio no mesmo worker. */
export async function processInstagramWebhook(
  payload: MetaWebhook,
  metaEventKey: string,
) {
  const supabase = getSupabaseAdmin()
  if (!supabase) return { processed: 0, demo: true }
  let processed = 0

  for (const entry of payload.entry ?? []) {
    const accountResult = await supabase
      .from('instagram_accounts')
      .select('id,workspace_id')
      .eq('instagram_user_id', entry.id ?? '')
      .maybeSingle()
    const account = accountResult.data
    if (!account) continue

    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id
      if (!senderId) continue
      const inboundText = event.message?.text ?? event.postback?.title ?? ''
      const metaId =
        event.message?.mid ??
        event.postback?.mid ??
        `${metaEventKey}:${processed}`
      await ingestInbound({
        supabase,
        workspaceId: account.workspace_id,
        accountId: account.id,
        senderId,
        metaId,
        text: inboundText,
        channel: event.postback
          ? 'postback'
          : event.reaction
            ? 'reaction'
            : 'dm',
        raw: event,
        timestamp: event.timestamp,
      })
      processed++
    }

    for (const change of entry.changes ?? []) {
      if (
        !['comments', 'mentions', 'message_reactions'].includes(
          change.field ?? '',
        )
      )
        continue
      const value = change.value ?? {}
      const sender = value.from as
        { id?: string; username?: string } | undefined
      const senderId = sender?.id
      if (!senderId) continue
      await ingestInbound({
        supabase,
        workspaceId: account.workspace_id,
        accountId: account.id,
        senderId,
        username: sender.username,
        metaId: String(value.id ?? `${metaEventKey}:${processed}`),
        text: String(value.text ?? ''),
        channel:
          change.field === 'comments'
            ? 'comment'
            : change.field === 'mentions'
              ? 'mention'
              : 'reaction',
        raw: value,
      })
      processed++
    }
  }

  await supabase
    .from('webhook_events')
    .update({ status: 'processed', processed_at: new Date().toISOString() })
    .eq('meta_event_key', metaEventKey)
  return { processed, demo: false }
}

/** Upsert do contato e da interação inbound; índices únicos tornam a operação repetível. */
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
  const receivedAt = input.timestamp
    ? new Date(input.timestamp).toISOString()
    : new Date().toISOString()
  const contactResult = await input.supabase
    .from('contacts')
    .upsert(
      {
        workspace_id: input.workspaceId,
        instagram_account_id: input.accountId,
        instagram_user_id: input.senderId,
        username: input.username,
        last_interaction_at: receivedAt,
        last_inbound_at: receivedAt,
      },
      { onConflict: 'workspace_id,instagram_user_id' },
    )
    .select('id')
    .single()
  if (contactResult.error) throw contactResult.error
  await input.supabase.from('interactions_log').upsert(
    {
      workspace_id: input.workspaceId,
      instagram_account_id: input.accountId,
      contact_id: contactResult.data.id,
      meta_event_id: input.metaId,
      channel: input.channel,
      direction: 'inbound',
      message_text: input.text,
      status: 'delivered',
      meta_created_at: receivedAt,
      raw_payload: input.raw,
    },
    { onConflict: 'workspace_id,meta_event_id', ignoreDuplicates: true },
  )
  await matchAndScheduleTriggers({ ...input, contactId: contactResult.data.id })
}

/**
 * Aplica opt-out, origem, match e cooldown; o resultado é sempre um job assíncrono.
 * A elegibilidade final não é decidida aqui: o scheduler a revalida na execução.
 */
async function matchAndScheduleTriggers(input: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
  workspaceId: string
  accountId: string
  contactId: string
  senderId: string
  metaId: string
  text: string
  channel: string
  raw: unknown
}) {
  const source =
    input.channel === 'comment'
      ? 'comment'
      : input.channel === 'story_reply'
        ? 'story'
        : input.channel === 'dm' || input.channel === 'postback'
          ? 'dm'
          : null
  if (!source || !input.text) return
  if (input.text.trim().toLocaleLowerCase('pt-BR') === 'parar') {
    await input.supabase
      .from('contacts')
      .update({ opted_out_at: new Date().toISOString(), ai_enabled: false })
      .eq('id', input.contactId)
    return
  }

  const { data: triggers } = await input.supabase
    .from('triggers')
    .select(
      'id,keyword,match_mode,response_text,sequence_id,cooldown_hours,auto_tag_id',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('source', source)
    .eq('is_active', true)
  const normalized = input.text.trim().toLocaleLowerCase('pt-BR')
  for (const trigger of triggers ?? []) {
    const keyword = String(trigger.keyword).toLocaleLowerCase('pt-BR')
    const matches =
      trigger.match_mode === 'exact'
        ? normalized === keyword
        : normalized.includes(keyword)
    if (!matches) continue
    const { data: cooldown } = await input.supabase
      .from('trigger_cooldowns')
      .select('last_fired_at')
      .eq('trigger_id', trigger.id)
      .eq('contact_id', input.contactId)
      .maybeSingle()
    if (
      cooldown &&
      Date.now() - new Date(cooldown.last_fired_at).getTime() <
        trigger.cooldown_hours * 3_600_000
    )
      continue

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
        },
        { onConflict: 'contact_id,tag_id' },
      )

    if (trigger.sequence_id) {
      const { data: enrollment } = await input.supabase
        .from('sequence_enrollments')
        .insert({
          workspace_id: input.workspaceId,
          sequence_id: trigger.sequence_id,
          contact_id: input.contactId,
          next_run_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (enrollment)
        await input.supabase.from('scheduled_jobs').insert({
          workspace_id: input.workspaceId,
          kind: 'sequence_step',
          payload: {
            enrollmentId: enrollment.id,
            position: 0,
            senderId: input.senderId,
            instagramCommentId: source === 'comment' ? input.metaId : null,
          },
          run_at: new Date().toISOString(),
        })
    } else if (trigger.response_text) {
      await input.supabase.from('scheduled_jobs').insert({
        workspace_id: input.workspaceId,
        kind: 'sequence_step',
        payload: {
          contactId: input.contactId,
          responseText: trigger.response_text,
          senderId: input.senderId,
          instagramCommentId: source === 'comment' ? input.metaId : null,
        },
        run_at: new Date().toISOString(),
      })
    }
  }
}
