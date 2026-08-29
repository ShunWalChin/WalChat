/**
 * Orçamento e observabilidade do provedor de IA por workspace.
 *
 * O limite existe porque a chave é do operador, não do produto: um fluxo em
 * laço consumiria o orçamento dele sem aviso. O log registra tokens, latência,
 * modelo e falha, mas nunca prompt nem resposta — são dados do contato.
 */
import '@tanstack/react-start/server-only'
import { ApiError } from './api-auth.server'
import { getSupabaseAdmin } from './supabase-admin.server'

function monthStartIso(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString()
}

export async function assertAiTokenBudget(workspaceId: string) {
  const admin = getSupabaseAdmin()
  if (!admin) return { limit: 0, used: 0 }
  const { data: budget, error: budgetError } = await admin
    .from('ai_budgets')
    .select('monthly_token_limit,hard_stop')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (budgetError?.code === '42P01') return { limit: 0, used: 0 }
  if (budgetError) throw budgetError
  const limit = Number(budget?.monthly_token_limit ?? 0)
  if (!limit) return { limit: 0, used: 0 }
  const { data: executions, error } = await admin
    .from('ai_execution_log')
    .select('input_tokens,output_tokens')
    .eq('workspace_id', workspaceId)
    .gte('created_at', monthStartIso())
    .in('status', ['completed', 'failed'])
    .limit(10_000)
  if (error?.code === '42P01') return { limit: 0, used: 0 }
  if (error) throw error
  const used = executions.reduce(
    (total, execution) =>
      total +
      Number(execution.input_tokens ?? 0) +
      Number(execution.output_tokens ?? 0),
    0,
  )
  if (budget?.hard_stop && used >= limit)
    throw new ApiError(
      429,
      'O orçamento mensal de tokens de IA foi atingido neste workspace.',
    )
  return { limit, used }
}

export async function writeAiExecution(input: {
  workspaceId: string
  agentId: string
  provider: string
  model: string
  purpose?: string
  status: 'completed' | 'failed' | 'blocked'
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  errorCode?: string | null
}) {
  const admin = getSupabaseAdmin()
  if (!admin) return
  const { error } = await admin.from('ai_execution_log').insert({
    workspace_id: input.workspaceId,
    agent_id: input.agentId,
    provider: input.provider,
    model: input.model,
    purpose: input.purpose ?? 'conversation',
    status: input.status,
    input_tokens: Math.max(0, Math.trunc(input.inputTokens ?? 0)),
    output_tokens: Math.max(0, Math.trunc(input.outputTokens ?? 0)),
    latency_ms:
      input.latencyMs === undefined
        ? null
        : Math.max(0, Math.trunc(input.latencyMs)),
    error_code: input.errorCode?.slice(0, 100) ?? null,
    completed_at: new Date().toISOString(),
  })
  if (error && error.code !== '42P01')
    console.error(
      JSON.stringify({
        event: 'ai_execution_log_failed',
        error: error.code,
      }),
    )
}

export function aiErrorCode(error: unknown) {
  if (error instanceof ApiError) return `api_${error.status}`
  if (error instanceof Error) return error.name.slice(0, 100)
  return 'unknown_error'
}
