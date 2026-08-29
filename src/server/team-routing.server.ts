/** Distribuição automática de conversas inbound respeitando horário e capacidade. */
import '@tanstack/react-start/server-only'
import type { getSupabaseAdmin } from './supabase-admin.server'

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>
export type RoutingStrategy = 'round_robin' | 'least_loaded' | 'manual'
export type RoutingCandidate = {
  userId: string
  available: boolean
  capacity: number
  openConversations: number
  lastAssignedAt: string | null
}
export type BusinessHours = {
  timezone: string
  weekdays: number[]
  start: string
  end: string
}

const defaultBusinessHours: BusinessHours = {
  timezone: 'America/Sao_Paulo',
  weekdays: [1, 2, 3, 4, 5],
  start: '08:00',
  end: '18:00',
}

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function isWithinBusinessHours(hours: BusinessHours, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    )
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      values.weekday,
    )
    if (!hours.weekdays.includes(weekday)) return false
    const current = Number(values.hour) * 60 + Number(values.minute)
    const start = clockMinutes(hours.start)
    const end = clockMinutes(hours.end)
    return start <= end
      ? current >= start && current <= end
      : current >= start || current <= end
  } catch {
    return false
  }
}

export function selectRoutingCandidate(
  candidates: RoutingCandidate[],
  strategy: RoutingStrategy,
  globalCapacity: number,
) {
  if (strategy === 'manual') return null
  const eligible = candidates.filter(
    (candidate) =>
      candidate.available &&
      candidate.openConversations <
        Math.min(candidate.capacity, globalCapacity),
  )
  eligible.sort((left, right) => {
    if (strategy === 'least_loaded') {
      const leftRatio = left.openConversations / left.capacity
      const rightRatio = right.openConversations / right.capacity
      if (leftRatio !== rightRatio) return leftRatio - rightRatio
    }
    const leftAssigned = left.lastAssignedAt
      ? new Date(left.lastAssignedAt).getTime()
      : 0
    const rightAssigned = right.lastAssignedAt
      ? new Date(right.lastAssignedAt).getTime()
      : 0
    if (leftAssigned !== rightAssigned) return leftAssigned - rightAssigned
    if (left.openConversations !== right.openConversations)
      return left.openConversations - right.openConversations
    return left.userId.localeCompare(right.userId)
  })
  return eligible[0] ?? null
}

function validBusinessHours(value: unknown): BusinessHours {
  if (!value || typeof value !== 'object') return defaultBusinessHours
  const input = value as Partial<BusinessHours>
  if (
    typeof input.timezone !== 'string' ||
    !Array.isArray(input.weekdays) ||
    typeof input.start !== 'string' ||
    typeof input.end !== 'string'
  )
    return defaultBusinessHours
  return {
    timezone: input.timezone,
    weekdays: input.weekdays.filter(
      (day): day is number => Number.isInteger(day) && day >= 0 && day <= 6,
    ),
    start: input.start,
    end: input.end,
  }
}

/** Nunca deixa uma falha de roteamento derrubar o webhook que recebeu a mensagem. */
export async function assignConversationByRouting(input: {
  admin: AdminClient
  workspaceId: string
  conversationId: string
  now?: Date
}) {
  try {
    const [settingsResult, availabilityResult, openResult] = await Promise.all([
      input.admin
        .from('workspace_runtime_settings')
        .select('routing_strategy,max_open_conversations,business_hours')
        .eq('workspace_id', input.workspaceId)
        .maybeSingle(),
      input.admin
        .from('attendant_availability')
        .select('user_id,is_available,capacity,last_assigned_at')
        .eq('workspace_id', input.workspaceId)
        .eq('is_available', true),
      input.admin
        .from('conversations')
        .select('assigned_to')
        .eq('workspace_id', input.workspaceId)
        .in('status', ['open', 'pending'])
        .not('assigned_to', 'is', null),
    ])
    for (const result of [settingsResult, availabilityResult, openResult])
      if (result.error) throw result.error
    const strategy = (settingsResult.data?.routing_strategy ??
      'round_robin') as RoutingStrategy
    const hours = validBusinessHours(settingsResult.data?.business_hours)
    if (!isWithinBusinessHours(hours, input.now)) return { assignedTo: null }

    const openCounts = new Map<string, number>()
    for (const conversation of openResult.data ?? [])
      if (conversation.assigned_to)
        openCounts.set(
          conversation.assigned_to,
          (openCounts.get(conversation.assigned_to) ?? 0) + 1,
        )
    const candidate = selectRoutingCandidate(
      (availabilityResult.data ?? []).map((row) => ({
        userId: row.user_id,
        available: row.is_available,
        capacity: row.capacity,
        openConversations: openCounts.get(row.user_id) ?? 0,
        lastAssignedAt: row.last_assigned_at,
      })),
      strategy,
      settingsResult.data?.max_open_conversations ?? 20,
    )
    if (!candidate) return { assignedTo: null }

    const assignedAt = (input.now ?? new Date()).toISOString()
    const { data: assigned, error } = await input.admin
      .from('conversations')
      .update({ assigned_to: candidate.userId })
      .eq('workspace_id', input.workspaceId)
      .eq('id', input.conversationId)
      .is('assigned_to', null)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!assigned) return { assignedTo: null }
    await Promise.all([
      input.admin
        .from('attendant_availability')
        .update({ last_assigned_at: assignedAt })
        .eq('workspace_id', input.workspaceId)
        .eq('user_id', candidate.userId),
      input.admin.from('api_audit_log').insert({
        workspace_id: input.workspaceId,
        actor_user_id: null,
        action: 'conversation_auto_assigned',
        resource_type: 'conversation',
        resource_id: input.conversationId,
        changes: { assignedTo: candidate.userId, strategy },
      }),
    ])
    return { assignedTo: candidate.userId }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'conversation_routing_failed',
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        error:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : error instanceof Error
              ? error.name
              : 'unknown_error',
      }),
    )
    return { assignedTo: null }
  }
}
