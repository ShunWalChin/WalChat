/** Scheduler de sequências e campanhas; é a última fronteira antes de chamar a Meta. */
import { getSupabaseAdmin } from '../server/supabase-admin.server'
import {
  sendInstagramMessage,
  sendInstagramPrivateReply,
} from '../server/meta-sender.server'
import { sendWhatsAppMessage } from '../server/whatsapp-sender.server'
import {
  getMetaAccountAccess,
  saveIntegrationCredential,
  writeIntegrationAudit,
} from '../server/integration-credentials.server'
import {
  MetaApiError,
  createMetaPublishContainer,
  getMetaContainerStatus,
  getMetaPublishingLimit,
  publishMetaContainer,
  refreshMetaAccessToken,
} from '../server/meta-api.server'
import {
  UnsupportedScheduledJobError,
  isTerminalScheduledJobError,
  operationalErrorCode,
  privateReplyFailureStatus,
} from '../server/scheduled-job-policy'
import { writeWorkerHeartbeat } from '../server/worker-heartbeat'
import { applyBookingLink } from '../server/booking-links.server'
import { syncGoogleConnection } from '../server/google-calendar.server'
import {
  markAutomationExecutionFailure,
  processAutomationStep,
  resumeAutomationAfterMessage,
} from '../server/automation-engine.server'
import { n8nDispatchSchema } from '../server/n8n-contract'
import { sendN8nEvent } from '../server/n8n-integration.server'
import { syncWorkspaceInstagramInsights } from '../server/insights-sync.server'

/** Falha cedo: um scheduler sem service role não pode operar com segurança. */
function requireSupabase() {
  const client = getSupabaseAdmin()
  if (!client)
    throw new Error(
      'Supabase service role é obrigatório para iniciar o scheduler.',
    )
  return client
}

const supabase = requireSupabase()
let lastTokenRefreshSweep = 0
let lastRecoverySweep = 0
let lastGoogleCalendarSweep = 0

/**
 * Recupera locks abandonados após crash. Claims externos antigos viram
 * `unknown` antes do job voltar à fila, impedindo um segundo disparo cego.
 */
async function recoverStaleWork() {
  if (Date.now() - lastRecoverySweep < 5 * 60_000) return
  lastRecoverySweep = Date.now()
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString()
  const now = new Date().toISOString()
  const { error: deliveryError } = await supabase
    .from('outbound_deliveries')
    .update({
      status: 'unknown',
      last_error_code: 'stale_claim_recovered',
      completed_at: now,
    })
    .eq('status', 'claimed')
    .lt('claimed_at', cutoff)
  if (deliveryError) throw deliveryError
  const { error: jobError } = await supabase
    .from('scheduled_jobs')
    .update({
      status: 'pending',
      locked_at: null,
      run_at: now,
      last_error: 'stale_lock_recovered',
    })
    .eq('status', 'processing')
    .lt('locked_at', cutoff)
  if (jobError) throw jobError
}

/** Renova tokens long-lived antes do vencimento e isola falhas por conta. */
async function refreshDueMetaTokens() {
  if (Date.now() - lastTokenRefreshSweep < 60 * 60_000) return
  lastTokenRefreshSweep = Date.now()
  const { data: accounts, error } = await supabase
    .from('instagram_accounts')
    .select('id,workspace_id,token_expires_at')
    .eq('status', 'connected')
    .lte('token_refresh_after', new Date().toISOString())
    .limit(20)
  if (error) throw error
  for (const account of accounts) {
    try {
      const current = await getMetaAccountAccess({
        workspaceId: account.workspace_id,
        instagramAccountId: account.id,
      })
      const refreshed = await refreshMetaAccessToken(current.accessToken)
      const expiresIn = refreshed.expires_in ?? 60 * 24 * 60 * 60
      const now = new Date()
      const expiresAt = new Date(
        now.getTime() + expiresIn * 1_000,
      ).toISOString()
      const refreshAfter = new Date(
        now.getTime() + Math.min(expiresIn * 500, 30 * 24 * 60 * 60_000),
      ).toISOString()
      await saveIntegrationCredential({
        workspaceId: account.workspace_id,
        provider: 'meta',
        credentialType: 'access_token',
        scopeKey: account.id,
        instagramAccountId: account.id,
        value: refreshed.access_token,
        expiresAt,
        metadata: { tokenType: refreshed.token_type ?? 'bearer' },
      })
      await supabase
        .from('instagram_accounts')
        .update({
          token_expires_at: expiresAt,
          token_refresh_after: refreshAfter,
          last_token_refresh_at: now.toISOString(),
          connection_error: null,
        })
        .eq('id', account.id)
      await writeIntegrationAudit({
        workspaceId: account.workspace_id,
        provider: 'meta',
        action: 'token_refreshed',
        status: 'success',
        resourceId: account.id,
      })
    } catch (caught) {
      const message = operationalErrorCode(caught)
      const expired =
        account.token_expires_at &&
        new Date(account.token_expires_at).getTime() <= Date.now()
      await supabase
        .from('instagram_accounts')
        .update({
          status: expired ? 'expired' : 'connected',
          connection_error: message,
        })
        .eq('id', account.id)
      await writeIntegrationAudit({
        workspaceId: account.workspace_id,
        provider: 'meta',
        action: 'token_refreshed',
        status: 'failure',
        resourceId: account.id,
      })
    }
  }
  const { error: whatsappExpiryError } = await supabase
    .from('whatsapp_accounts')
    .update({
      status: 'expired',
      connection_error: 'access_token_expired',
    })
    .eq('status', 'connected')
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', new Date().toISOString())
  if (whatsappExpiryError) throw whatsappExpiryError
}

/** Mantém Calendar e Tasks atualizados sem depender do botão da interface. */
async function syncDueGoogleCalendars() {
  if (Date.now() - lastGoogleCalendarSweep < 5 * 60_000) return
  lastGoogleCalendarSweep = Date.now()
  const cutoff = Date.now() - 5 * 60_000
  const { data: connections, error } = await supabase
    .from('calendar_connections')
    .select('id,workspace_id,last_sync_at')
    .eq('status', 'connected')
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(10)
  if (error) throw error
  for (const connection of connections) {
    if (
      connection.last_sync_at &&
      new Date(connection.last_sync_at).getTime() > cutoff
    )
      continue
    try {
      await syncGoogleConnection({
        workspaceId: connection.workspace_id,
        connectionId: connection.id,
      })
    } catch (caught) {
      const code = operationalErrorCode(caught)
      await supabase
        .from('calendar_connections')
        .update({
          connection_error: code,
          last_sync_at: new Date().toISOString(),
        })
        .eq('id', connection.id)
        .eq('workspace_id', connection.workspace_id)
      await writeIntegrationAudit({
        workspaceId: connection.workspace_id,
        provider: 'google',
        action: 'calendar_sync',
        status: 'failure',
        resourceId: connection.id,
        details: { code },
      })
    }
  }
}

/**
 * Busca um lote limitado e adquire lock otimista com update condicional.
 * Falhas transitórias recebem backoff exponencial; a quinta tentativa é terminal.
 */
async function processDueJobs() {
  const { data: jobs, error } = await supabase.rpc('claim_due_scheduled_jobs', {
    batch_size: 50,
  })
  if (error) throw error
  for (const job of jobs) {
    try {
      if (job.kind === 'sequence_step') await processSequenceJob(job)
      else if (job.kind === 'automation_step') await processAutomationStep(job)
      else if (job.kind === 'integration_event')
        await processIntegrationEventJob(job)
      else if (job.kind === 'campaign_message') await processCampaignJob(job)
      else if (job.kind === 'content_publish')
        await processContentPublishJob(job)
      else if (job.kind === 'insights_sync') await processInsightsSyncJob(job)
      else throw new UnsupportedScheduledJobError(job.kind)
      const { error: completedError } = await supabase
        .from('scheduled_jobs')
        .update({ status: 'completed' })
        .eq('id', job.id)
      if (completedError) throw completedError
    } catch (caught) {
      const message = operationalErrorCode(caught)
      const terminal = job.attempts >= 5 || isTerminalScheduledJobError(caught)
      await supabase
        .from('scheduled_jobs')
        .update({
          status: terminal ? 'failed' : 'pending',
          last_error: message,
          run_at: new Date(
            Date.now() + 2 ** Math.max(0, job.attempts - 1) * 30_000,
          ).toISOString(),
          locked_at: null,
        })
        .eq('id', job.id)
      const automationRunId = job.payload?.automationRunId
      if (typeof automationRunId === 'string')
        await supabase
          .from('automation_runs')
          .update({
            status: terminal ? 'failed' : 'scheduled',
            reason: terminal ? message : 'retry_scheduled',
          })
          .eq('id', automationRunId)
          .eq('workspace_id', job.workspace_id)
      const flowExecutionId = job.payload?.flowExecutionId
      if (typeof flowExecutionId === 'string')
        await markAutomationExecutionFailure({
          workspaceId: job.workspace_id,
          executionId: flowExecutionId,
          terminal,
          errorCode: message,
        })
      console.error(
        JSON.stringify({
          event: 'scheduled_job_failed',
          jobId: job.id,
          error: message,
        }),
      )
    }
  }
}

async function processInsightsSyncJob(job: {
  workspace_id: string
  payload: Record<string, unknown>
}) {
  const instagramAccountId = String(job.payload.instagramAccountId ?? '')
  if (!instagramAccountId)
    throw new UnsupportedScheduledJobError('insights_account_missing')
  await syncWorkspaceInstagramInsights({
    workspaceId: job.workspace_id,
    instagramAccountId,
  })
}

/** Publica um rascunho por container reutilizável e tolerante a retries. */
async function processContentPublishJob(job: {
  id: string
  workspace_id: string
  payload: Record<string, unknown>
}) {
  const contentItemId = String(job.payload.contentItemId ?? '')
  if (!contentItemId) throw new Error('content_job_payload_invalid')
  const { data: item, error } = await supabase
    .from('content_items')
    .select(
      'id,instagram_account_id,kind,caption,media,status,meta_container_id,provider_media_id',
    )
    .eq('workspace_id', job.workspace_id)
    .eq('id', contentItemId)
    .maybeSingle()
  if (error) throw error
  if (!item || item.status === 'published') return
  if (!['scheduled', 'publishing'].includes(item.status)) return
  if (!item.instagram_account_id)
    throw new UnsupportedScheduledJobError('content_account_missing')
  try {
    const access = await getMetaAccountAccess({
      workspaceId: job.workspace_id,
      instagramAccountId: item.instagram_account_id,
    })
    let containerId = item.meta_container_id as string | null
    if (!containerId) {
      const limit = await getMetaPublishingLimit({
        instagramUserId: access.instagramUserId,
        accessToken: access.accessToken,
      })
      const usage = limit.data?.[0]?.quota_usage ?? 0
      const total = limit.data?.[0]?.config?.quota_total ?? 100
      if (usage >= total) {
        await failContentItem(contentItemId, 'meta_publishing_limit')
        throw new UnsupportedScheduledJobError('content_publishing_limit')
      }
      const container = await createMetaPublishContainer({
        instagramUserId: access.instagramUserId,
        accessToken: access.accessToken,
        kind: item.kind,
        caption: item.caption,
        media: item.media,
      })
      containerId = container.id
      const { error: containerError } = await supabase
        .from('content_items')
        .update({
          status: 'publishing',
          meta_container_id: containerId,
          last_publish_attempt_at: new Date().toISOString(),
          publish_error_code: null,
        })
        .eq('workspace_id', job.workspace_id)
        .eq('id', item.id)
      if (containerError) throw containerError
    }
    const status = await getMetaContainerStatus({
      containerId,
      accessToken: access.accessToken,
    })
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      await failContentItem(
        item.id,
        `meta_container_${status.status_code.toLowerCase()}`,
      )
      throw new UnsupportedScheduledJobError(
        `content_container_${status.status_code.toLowerCase()}`,
      )
    }
    if (status.status_code === 'IN_PROGRESS')
      throw new Error('content_container_processing')
    if (status.status_code === 'PUBLISHED') {
      const { error: publishedError } = await supabase
        .from('content_items')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          publish_error_code: null,
        })
        .eq('workspace_id', job.workspace_id)
        .eq('id', item.id)
      if (publishedError) throw publishedError
      return
    }
    const published = await publishMetaContainer({
      instagramUserId: access.instagramUserId,
      containerId,
      accessToken: access.accessToken,
    })
    const { error: publishedError } = await supabase
      .from('content_items')
      .update({
        status: 'published',
        provider_media_id: published.id,
        published_at: new Date().toISOString(),
        publish_error_code: null,
      })
      .eq('workspace_id', job.workspace_id)
      .eq('id', item.id)
    if (publishedError) throw publishedError
  } catch (caught) {
    if (caught instanceof MetaApiError && caught.status < 500) {
      await failContentItem(item.id, `meta_http_${caught.status}`)
      throw new UnsupportedScheduledJobError(
        `content_meta_http_${caught.status}`,
      )
    }
    throw caught
  }
}

async function failContentItem(contentItemId: string, code: string) {
  const { error } = await supabase
    .from('content_items')
    .update({ status: 'failed', publish_error_code: code.slice(0, 120) })
    .eq('id', contentItemId)
  if (error) throw error
}

/**
 * Revalida cada destinatário no instante do envio. A prévia da campanha nunca
 * é tratada como autorização, porque a janela de 24h pode fechar na fila.
 */
async function processCampaignJob(job: {
  id: string
  workspace_id: string
  payload: Record<string, unknown>
}) {
  const campaignId = String(job.payload.campaignId ?? '')
  const recipientId = String(job.payload.recipientId ?? '')
  if (!campaignId || !recipientId)
    throw new Error('campaign_job_payload_invalid')
  const { data: recipient, error } = await supabase
    .from('campaign_recipients')
    .select('id,contact_id,status,campaigns!inner(id,message,status)')
    .eq('workspace_id', job.workspace_id)
    .eq('campaign_id', campaignId)
    .eq('id', recipientId)
    .maybeSingle()
  if (error) throw error
  if (!recipient || recipient.status !== 'queued') return
  const campaign = Array.isArray(recipient.campaigns)
    ? recipient.campaigns[0]
    : recipient.campaigns
  if (!['scheduled', 'running'].includes(campaign.status)) return

  const result = await processSequenceJob({
    ...job,
    payload: {
      contactId: recipient.contact_id,
      responseText: campaign.message,
      campaignId,
      campaignRecipientId: recipient.id,
    },
  })
  const status = result?.sent ? 'sent' : 'blocked'
  const { error: recipientError } = await supabase
    .from('campaign_recipients')
    .update({
      status,
      reason: result?.reason ?? null,
      sent_at: result?.sent ? new Date().toISOString() : null,
    })
    .eq('id', recipient.id)
    .eq('workspace_id', job.workspace_id)
  if (recipientError) throw recipientError
  const { count: pending, error: pendingError } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', job.workspace_id)
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')
  if (pendingError) throw pendingError
  if (!pending) {
    const { error: completeError } = await supabase
      .from('campaigns')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', campaignId)
      .eq('workspace_id', job.workspace_id)
      .in('status', ['scheduled', 'running'])
    if (completeError) throw completeError
  }
}

/** Entrega a outbox de integrações com o mesmo delivery ID nos retries. */
async function processIntegrationEventJob(job: {
  id: string
  workspace_id: string
  payload: Record<string, unknown>
}) {
  const input = n8nDispatchSchema.parse({
    eventType: job.payload.eventType,
    payload: job.payload.eventData,
    deliveryId: job.payload.deliveryId,
  })
  await sendN8nEvent({
    workspaceId: job.workspace_id,
    eventType: input.eventType,
    payload: input.payload,
    deliveryId: input.deliveryId,
  })
}

/** Resolve o passo atual, revalida o contato, envia e agenda o passo seguinte. */
async function processSequenceJob(job: {
  id: string
  workspace_id: string
  payload: Record<string, unknown>
}): Promise<{ sent: boolean; reason?: string } | undefined> {
  const payload = job.payload
  let contactId = payload.contactId as string | undefined
  let message = payload.responseText as string | undefined
  let mediaUrl: string | null = null
  const senderId = String(payload.senderId ?? '')
  const commentId = payload.instagramCommentId
    ? String(payload.instagramCommentId)
    : null
  const commentCreatedAt = payload.commentCreatedAt
    ? String(payload.commentCreatedAt)
    : null
  const enrollmentId = payload.enrollmentId as string | undefined
  const aiGenerated = payload.aiGenerated === true
  const automationRunId = payload.automationRunId
    ? String(payload.automationRunId)
    : null
  const flowExecutionId = payload.flowExecutionId
    ? String(payload.flowExecutionId)
    : null
  const flowNodeId = payload.flowNodeId ? String(payload.flowNodeId) : null
  const flowNextNodeId = payload.flowNextNodeId
    ? String(payload.flowNextNodeId)
    : null
  const triggerId = payload.triggerId ? String(payload.triggerId) : null
  const bookingPageId = payload.bookingPageId
    ? String(payload.bookingPageId)
    : null
  const position = Number(payload.position ?? 0)
  const requestedPlatform =
    payload.platform === 'whatsapp' ? 'whatsapp' : 'instagram'

  if (enrollmentId) {
    const enrollmentResult = await supabase
      .from('sequence_enrollments')
      .select('id,contact_id,sequence_id,status')
      .eq('id', enrollmentId)
      .single()
    const enrollment = enrollmentResult.data
    if (!enrollment || enrollment.status !== 'active') return
    contactId = enrollment.contact_id
    const stepResult = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('position', position)
      .maybeSingle()
    const step = stepResult.data
    if (!step) {
      await supabase
        .from('sequence_enrollments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          next_run_at: null,
        })
        .eq('id', enrollment.id)
      return
    }
    if (step.kind === 'media') {
      mediaUrl = step.media_url
      message = step.content ?? 'Mídia automática'
    } else if (step.kind !== 'typing' && step.kind !== 'delay') {
      message = step.content ?? undefined
    }
  }
  if (message && bookingPageId)
    message = await applyBookingLink({
      workspaceId: job.workspace_id,
      bookingPageId,
      message,
    })
  if (!contactId) throw new Error('Job sem contato.')

  const [contactResult, blocklistResult] = await Promise.all([
    supabase
      .from('contacts')
      .select(
        'id,platform,last_inbound_at,opted_out_at,instagram_user_id,instagram_account_id,whatsapp_user_id,whatsapp_account_id',
      )
      .eq('workspace_id', job.workspace_id)
      .eq('id', contactId)
      .single(),
    supabase
      .from('blocklist_entries')
      .select('term')
      .eq('workspace_id', job.workspace_id)
      .eq('is_active', true),
  ])
  if (contactResult.error) throw contactResult.error
  if (blocklistResult.error) throw blocklistResult.error
  const contact = contactResult.data
  const platform = contact.platform ?? requestedPlatform
  if (
    platform === 'instagram' &&
    (!contact.instagram_account_id || !contact.instagram_user_id)
  )
    throw new Error('Contato não possui conta Instagram vinculada.')
  if (
    platform === 'whatsapp' &&
    (!contact.whatsapp_account_id || !contact.whatsapp_user_id)
  )
    throw new Error('Contato não possui conta WhatsApp vinculada.')

  if (message) {
    const common = {
      workspaceId: job.workspace_id,
      contactId: contact.id,
      idempotencyKey: `scheduled-job:${job.id}`,
      deliverySource: 'scheduled' as const,
      scheduledJobId: job.id,
      lastInboundAt: contact.last_inbound_at,
      optedOutAt: contact.opted_out_at,
      isAutomated: true,
      message,
      commentCreatedAt,
      blocklist: blocklistResult.data.map((entry) => entry.term),
      mediaUrl,
      mediaType:
        mediaUrl && /\.(mp4|mov)(\?|$)/i.test(mediaUrl)
          ? ('video' as const)
          : ('image' as const),
    }
    let result
    if (platform === 'whatsapp') {
      result = await sendWhatsAppMessage({
        ...common,
        whatsappAccountId: contact.whatsapp_account_id as string,
        recipientId: senderId || (contact.whatsapp_user_id as string),
      })
    } else if (commentId) {
      // O insert ocorre antes da chamada externa: a PK funciona como claim
      // at-most-once mesmo com dois schedulers ou resposta HTTP ambígua.
      const { error: claimError } = await supabase
        .from('comment_private_replies')
        .insert({
          workspace_id: job.workspace_id,
          instagram_comment_id: commentId,
          contact_id: contact.id,
          job_id: job.id,
          trigger_id: triggerId,
          automation_run_id: automationRunId,
          status: 'pending',
        })
      if (claimError?.code === '23505')
        throw new Error('comment_already_replied')
      if (claimError) throw claimError
      try {
        result = await sendInstagramPrivateReply({
          ...common,
          instagramAccountId: contact.instagram_account_id as string,
          recipientId: senderId || (contact.instagram_user_id as string),
          instagramCommentId: commentId,
        })
        const { error: replyStatusError } = await supabase
          .from('comment_private_replies')
          .update({
            status: result.sent ? 'sent' : 'failed',
            replied_at: result.sent ? new Date().toISOString() : null,
            last_error: result.sent ? null : result.decision.reason,
          })
          .eq('instagram_comment_id', commentId)
          .eq('job_id', job.id)
        if (replyStatusError) throw replyStatusError
      } catch (replyError) {
        const failureStatus = privateReplyFailureStatus(replyError)
        await supabase
          .from('comment_private_replies')
          .update({
            status: failureStatus,
            last_error: operationalErrorCode(replyError),
          })
          .eq('instagram_comment_id', commentId)
          .eq('job_id', job.id)
        throw replyError
      }
    } else {
      result = await sendInstagramMessage({
        ...common,
        instagramAccountId: contact.instagram_account_id as string,
        recipientId: senderId || (contact.instagram_user_id as string),
      })
    }
    const accountPayload =
      platform === 'whatsapp'
        ? {
            platform: 'whatsapp',
            instagram_account_id: null,
            whatsapp_account_id: contact.whatsapp_account_id,
          }
        : {
            platform: 'instagram',
            instagram_account_id: contact.instagram_account_id,
            whatsapp_account_id: null,
          }
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .upsert(
        {
          workspace_id: job.workspace_id,
          contact_id: contact.id,
          ...accountPayload,
          last_message_preview: result.decision.body.slice(0, 180),
          last_message_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,contact_id,platform' },
      )
      .select('id')
      .single()
    if (conversationError) throw conversationError
    const deliveryId = 'deliveryId' in result ? result.deliveryId : undefined
    const interactionPayload = {
      workspace_id: job.workspace_id,
      contact_id: contact.id,
      conversation_id: conversation.id,
      outbound_delivery_id: deliveryId ?? null,
      ...accountPayload,
      channel: commentId ? 'comment' : 'dm',
      direction: 'outbound',
      message_text: result.decision.body,
      media_url: mediaUrl,
      status: result.sent ? 'sent' : 'blocked',
      is_automated: true,
      policy_used: result.decision.policy,
      block_reason: result.sent ? null : result.decision.reason,
      raw_payload: result.sent ? { meta: result } : {},
    }
    const interactionOperation = deliveryId
      ? supabase.from('interactions_log').upsert(interactionPayload, {
          onConflict: 'outbound_delivery_id',
        })
      : supabase.from('interactions_log').insert(interactionPayload)
    const { data: interaction, error: interactionError } =
      await interactionOperation.select('id').single()
    if (interactionError) throw interactionError
    const providerMessageId =
      'result' in result && result.result && typeof result.result === 'object'
        ? extractScheduledProviderMessageId(result.result)
        : undefined
    const { error: messageError } = await supabase.from('messages').upsert(
      {
        workspace_id: job.workspace_id,
        platform,
        conversation_id: conversation.id,
        contact_id: contact.id,
        interaction_id: interaction.id,
        provider_message_id: providerMessageId ?? null,
        direction: 'outbound',
        body: result.decision.body,
        media_url: mediaUrl,
        status: result.sent ? 'sent' : 'blocked',
        is_ai_generated: aiGenerated,
        is_automated: true,
      },
      { onConflict: 'interaction_id' },
    )
    if (messageError) throw messageError
    if (automationRunId)
      await supabase
        .from('automation_runs')
        .update({
          status: result.sent ? 'sent' : 'blocked',
          policy_used: result.decision.policy,
          reason: result.sent ? null : result.decision.reason,
        })
        .eq('id', automationRunId)
        .eq('workspace_id', job.workspace_id)
    await supabase
      .from('contacts')
      .update({
        last_interaction_at: new Date().toISOString(),
        last_outbound_at: result.sent ? new Date().toISOString() : null,
      })
      .eq('id', contact.id)
    if (flowExecutionId && flowNodeId && flowNextNodeId) {
      await resumeAutomationAfterMessage({
        workspaceId: job.workspace_id,
        executionId: flowExecutionId,
        nodeId: flowNodeId,
        nextNodeId: flowNextNodeId,
        sent: result.sent,
        privateReply: Boolean(commentId),
        reason: result.sent ? null : result.decision.reason,
        policy: result.decision.policy,
      })
      return {
        sent: result.sent,
        ...(result.sent ? {} : { reason: result.decision.reason }),
      }
    }
    if (!result.sent) {
      if (enrollmentId)
        await supabase
          .from('sequence_enrollments')
          .update({ status: 'blocked', blocked_reason: result.decision.reason })
          .eq('id', enrollmentId)
      return { sent: false, reason: result.decision.reason }
    }
    // A Meta permite uma única Private Reply; uma sequência só continua após
    // uma nova mensagem inbound do contato abrir a janela padrão de 24h.
    if (commentId && enrollmentId) {
      await supabase
        .from('sequence_enrollments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          next_run_at: null,
        })
        .eq('id', enrollmentId)
      return { sent: true }
    }
  }

  if (enrollmentId) {
    const enrollmentResult = await supabase
      .from('sequence_enrollments')
      .select('sequence_id')
      .eq('id', enrollmentId)
      .single()
    const sequenceId = enrollmentResult.data?.sequence_id
    if (!sequenceId) throw new Error('Sequência do enrollment não encontrada.')
    const nextPosition = position + 1
    const nextStep = await supabase
      .from('sequence_steps')
      .select('delay_seconds')
      .eq('sequence_id', sequenceId)
      .eq('position', nextPosition)
      .maybeSingle()
    if (nextStep.data) {
      const runAt = new Date(
        Date.now() + nextStep.data.delay_seconds * 1_000,
      ).toISOString()
      await supabase
        .from('sequence_enrollments')
        .update({ current_position: nextPosition, next_run_at: runAt })
        .eq('id', enrollmentId)
      await supabase.from('scheduled_jobs').upsert(
        {
          workspace_id: job.workspace_id,
          kind: 'sequence_step',
          dedupe_key: `enrollment:${enrollmentId}:step:${nextPosition}`,
          // Preserve the originating comment until the first message block. This
          // lets typing/delay blocks precede a single, idempotent Private Reply.
          payload: {
            enrollmentId,
            position: nextPosition,
            platform,
            whatsappAccountId:
              platform === 'whatsapp' ? contact.whatsapp_account_id : null,
            senderId,
            instagramCommentId: commentId,
            commentCreatedAt,
            triggerId,
            automationRunId,
            bookingPageId,
          },
          run_at: runAt,
        },
        { onConflict: 'workspace_id,dedupe_key', ignoreDuplicates: true },
      )
    } else {
      await supabase
        .from('sequence_enrollments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          next_run_at: null,
        })
        .eq('id', enrollmentId)
    }
  }
  return { sent: true }
}

function extractScheduledProviderMessageId(result: Record<string, unknown>) {
  if (typeof result.message_id === 'string') return result.message_id
  if (!Array.isArray(result.messages)) return undefined
  const first = result.messages[0]
  return first && typeof first === 'object' && 'id' in first
    ? String(first.id)
    : undefined
}

/** Isola erros de um ciclo para que o processo continue no tick seguinte. */
async function tick() {
  try {
    await recoverStaleWork()
    await refreshDueMetaTokens()
    await syncDueGoogleCalendars()
    await processDueJobs()
    await writeWorkerHeartbeat('scheduler', 'healthy')
  } catch (error) {
    await writeWorkerHeartbeat('scheduler', 'unhealthy', {
      detailCode: 'tick_failed',
    }).catch(() => undefined)
    console.error(
      JSON.stringify({
        event: 'scheduler_tick_failed',
        error: error instanceof Error ? error.name : 'unknown_error',
      }),
    )
  }
}

void writeWorkerHeartbeat('scheduler', 'starting').catch(() =>
  console.error(
    JSON.stringify({
      event: 'scheduler_heartbeat_failed',
      error: 'heartbeat_write_failed',
    }),
  ),
)
void tick()
const interval = setInterval(() => void tick(), 60_000)
process.on('SIGINT', () => {
  clearInterval(interval)
  process.exit(0)
})
process.on('SIGTERM', () => {
  clearInterval(interval)
  process.exit(0)
})
