/** Scheduler de sequências e campanhas; é a última fronteira antes de chamar a Meta. */
import { getSupabaseAdmin } from '../server/supabase-admin.server'
import {
  sendInstagramMessage,
  sendInstagramPrivateReply,
} from '../server/meta-sender.server'

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
  const enrollmentId = payload.enrollmentId as string | undefined
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

  const contactResult = await supabase
    .from('contacts')
    .select('id,last_inbound_at,opted_out_at,instagram_user_id')
    .eq('id', contactId)
    .single()
  const contact = contactResult.data
  if (!contact) throw new Error('Contato não encontrado.')

  if (message) {
    const common = {
      recipientId: senderId || contact.instagram_user_id,
      lastInboundAt: contact.last_inbound_at,
      optedOutAt: contact.opted_out_at,
      isAutomated: true,
      message,
    }
    let result
    if (commentId) {
      // A leitura é reforçada pela chave primária no banco para cobrir corrida entre processos.
      const replied = await supabase
        .from('comment_private_replies')
        .select('instagram_comment_id')
        .eq('instagram_comment_id', commentId)
        .maybeSingle()
      if (replied.data) throw new Error('comment_already_replied')
      result = await sendInstagramPrivateReply({
        ...common,
        instagramCommentId: commentId,
      })
      if (result.sent)
        await supabase.from('comment_private_replies').insert({
          workspace_id: job.workspace_id,
          instagram_comment_id: commentId,
          contact_id: contact.id,
        })
    } else {
      result = await sendInstagramMessage(common)
    }
    await supabase.from('interactions_log').insert({
      workspace_id: job.workspace_id,
      contact_id: contact.id,
      channel: commentId ? 'comment' : 'dm',
      direction: 'outbound',
      message_text: result.decision.body,
      status: result.sent ? 'sent' : 'blocked',
      is_automated: true,
      policy_used: result.decision.policy,
      block_reason: result.sent ? null : result.decision.reason,
    })
    if (!result.sent) {
      if (enrollmentId)
        await supabase
          .from('sequence_enrollments')
          .update({ status: 'blocked', blocked_reason: result.decision.reason })
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
