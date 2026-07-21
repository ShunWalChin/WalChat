/** Scheduler de sequências e campanhas; é a última fronteira antes de chamar a Meta. */
import { getSupabaseAdmin } from '../server/supabase-admin.server'
import {
  sendInstagramMessage,
  sendInstagramPrivateReply,
} from '../server/meta-sender.server'
import {
  getMetaAccountAccess,
  saveIntegrationCredential,
  writeIntegrationAudit,
} from '../server/integration-credentials.server'
import { refreshMetaAccessToken } from '../server/meta-api.server'

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
      const message = caught instanceof Error ? caught.message : String(caught)
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
}

/**
 * Busca um lote limitado e adquire lock otimista com update condicional.
 * Falhas transitórias recebem backoff exponencial; a quinta tentativa é terminal.
 */
async function processDueJobs() {
  const now = new Date().toISOString()
  const { data: jobs, error } = await supabase
    .from('scheduled_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', now)
    .order('run_at')
    .limit(50)
  if (error) throw error
  for (const job of jobs) {
    const lock = await supabase
      .from('scheduled_jobs')
      .update({
        status: 'processing',
        locked_at: now,
        attempts: job.attempts + 1,
      })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!lock.data) continue
    try {
      if (job.kind === 'sequence_step') await processSequenceJob(job)
      await supabase
        .from('scheduled_jobs')
        .update({ status: 'completed' })
        .eq('id', job.id)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      const terminal = job.attempts + 1 >= 5
      await supabase
        .from('scheduled_jobs')
        .update({
          status: terminal ? 'failed' : 'pending',
          last_error: message,
          run_at: new Date(
            Date.now() + 2 ** job.attempts * 30_000,
          ).toISOString(),
          locked_at: null,
        })
        .eq('id', job.id)
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

/** Resolve o passo atual, revalida o contato, envia e agenda o passo seguinte. */
async function processSequenceJob(job: {
  id: string
  workspace_id: string
  payload: Record<string, unknown>
}) {
  const payload = job.payload
  let contactId = payload.contactId as string | undefined
  let message = payload.responseText as string | undefined
  const senderId = String(payload.senderId ?? '')
  const commentId = payload.instagramCommentId
    ? String(payload.instagramCommentId)
    : null
  const commentCreatedAt = payload.commentCreatedAt
    ? String(payload.commentCreatedAt)
    : null
  const enrollmentId = payload.enrollmentId as string | undefined
  const aiGenerated = payload.aiGenerated === true
  const position = Number(payload.position ?? 0)

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
    if (step.kind !== 'typing') message = step.content ?? undefined
  }
  if (!contactId) throw new Error('Job sem contato.')

  const [contactResult, blocklistResult] = await Promise.all([
    supabase
      .from('contacts')
      .select(
        'id,last_inbound_at,opted_out_at,instagram_user_id,instagram_account_id',
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
  if (!contact.instagram_account_id)
    throw new Error('Contato não possui conta Instagram vinculada.')

  if (message) {
    const common = {
      workspaceId: job.workspace_id,
      instagramAccountId: contact.instagram_account_id,
      recipientId: senderId || contact.instagram_user_id,
      lastInboundAt: contact.last_inbound_at,
      optedOutAt: contact.opted_out_at,
      isAutomated: true,
      message,
      commentCreatedAt,
      blocklist: blocklistResult.data.map((entry) => entry.term),
    }
    let result
    if (commentId) {
      // O insert ocorre antes da chamada externa: a PK funciona como claim
      // at-most-once mesmo com dois schedulers ou resposta HTTP ambígua.
      const { error: claimError } = await supabase
        .from('comment_private_replies')
        .insert({
          workspace_id: job.workspace_id,
          instagram_comment_id: commentId,
          contact_id: contact.id,
          job_id: job.id,
          status: 'pending',
        })
      if (claimError?.code === '23505')
        throw new Error('comment_already_replied')
      if (claimError) throw claimError
      try {
        result = await sendInstagramPrivateReply({
          ...common,
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
        await supabase
          .from('comment_private_replies')
          .update({
            status: 'failed',
            last_error:
              replyError instanceof Error
                ? replyError.message
                : String(replyError),
          })
          .eq('instagram_comment_id', commentId)
          .eq('job_id', job.id)
        throw replyError
      }
    } else {
      result = await sendInstagramMessage(common)
    }
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .upsert(
        {
          workspace_id: job.workspace_id,
          instagram_account_id: contact.instagram_account_id,
          contact_id: contact.id,
          last_message_preview: result.decision.body.slice(0, 180),
          last_message_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,contact_id,instagram_account_id' },
      )
      .select('id')
      .single()
    if (conversationError) throw conversationError
    const { data: interaction, error: interactionError } = await supabase
      .from('interactions_log')
      .insert({
        workspace_id: job.workspace_id,
        instagram_account_id: contact.instagram_account_id,
        contact_id: contact.id,
        conversation_id: conversation.id,
        channel: commentId ? 'comment' : 'dm',
        direction: 'outbound',
        message_text: result.decision.body,
        status: result.sent ? 'sent' : 'blocked',
        is_automated: true,
        policy_used: result.decision.policy,
        block_reason: result.sent ? null : result.decision.reason,
        raw_payload: result.sent ? { meta: result } : {},
      })
      .select('id')
      .single()
    if (interactionError) throw interactionError
    await supabase.from('messages').insert({
      workspace_id: job.workspace_id,
      conversation_id: conversation.id,
      contact_id: contact.id,
      interaction_id: interaction.id,
      direction: 'outbound',
      body: result.decision.body,
      status: result.sent ? 'sent' : 'blocked',
      is_ai_generated: aiGenerated,
      is_automated: true,
    })
    await supabase
      .from('contacts')
      .update({
        last_interaction_at: new Date().toISOString(),
        last_outbound_at: result.sent ? new Date().toISOString() : null,
      })
      .eq('id', contact.id)
    if (!result.sent) {
      if (enrollmentId)
        await supabase
          .from('sequence_enrollments')
          .update({ status: 'blocked', blocked_reason: result.decision.reason })
          .eq('id', enrollmentId)
      return
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
      return
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
      await supabase.from('scheduled_jobs').insert({
        workspace_id: job.workspace_id,
        kind: 'sequence_step',
        payload: { enrollmentId, position: nextPosition, senderId },
        run_at: runAt,
      })
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
}

/** Isola erros de um ciclo para que o processo continue no tick seguinte. */
async function tick() {
  try {
    await refreshDueMetaTokens()
    await processDueJobs()
  } catch (error) {
    console.error('scheduler_tick_failed', error)
  }
}

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
