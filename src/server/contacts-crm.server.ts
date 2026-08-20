/** Regras compartilhadas das APIs do CRM de Contatos & Tags. */
import '@tanstack/react-start/server-only'
import type { User } from '@supabase/supabase-js'
import { ApiError } from './api-auth.server'
import type { getSupabaseAdmin } from './supabase-admin.server'

export const CONTACT_STAGES = [
  'lead',
  'engaged',
  'customer',
  'vip',
  'inactive',
] as const

export type ContactStage = (typeof CONTACT_STAGES)[number]
type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>

export function nullableText(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function normalizePhone(value: string | null | undefined) {
  const normalized = nullableText(value)
  if (!normalized) return null
  const hasPlus = normalized.startsWith('+')
  const digits = normalized.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15)
    throw new ApiError(400, 'Telefone deve conter entre 8 e 15 dígitos.')
  return `${hasPlus ? '+' : ''}${digits}`
}

export function contactDisplayName(contact: {
  display_name?: string | null
  full_name?: string | null
  username?: string | null
  phone?: string | null
  email?: string | null
}) {
  return (
    contact.display_name ??
    contact.full_name ??
    (contact.username ? `@${contact.username}` : null) ??
    contact.phone ??
    contact.email ??
    'Contato sem nome'
  )
}

export function eligibilityPresentation(policy: string) {
  switch (policy) {
    case 'standard_24h':
      return { label: '24h aberta', tone: 'green' as const }
    case 'human_agent_7d':
      return { label: 'HUMAN_AGENT', tone: 'orange' as const }
    case 'whatsapp_template':
      return { label: 'Requer template', tone: 'blue' as const }
    default:
      return { label: 'Bloqueado', tone: 'gray' as const }
  }
}

export async function requireWorkspaceContacts(input: {
  admin: AdminClient
  workspaceId: string
  contactIds: string[]
}) {
  const uniqueIds = Array.from(new Set(input.contactIds))
  const { data, error } = await input.admin
    .from('contacts')
    .select('id,platform,opted_out_at,archived_at')
    .eq('workspace_id', input.workspaceId)
    .in('id', uniqueIds)
  if (error) throw error
  if (data.length !== uniqueIds.length)
    throw new ApiError(404, 'Um ou mais contatos não foram encontrados.')
  return data
}

export async function writeContactAudit(input: {
  admin: AdminClient
  workspaceId: string
  contactIds: string[]
  actor: User
  action: string
  changes?: Record<string, unknown>
}) {
  const rows = Array.from(new Set(input.contactIds)).map((contactId) => ({
    workspace_id: input.workspaceId,
    contact_id: contactId,
    actor_user_id: input.actor.id,
    action: input.action,
    changes: input.changes ?? {},
  }))
  if (!rows.length) return
  const { error } = await input.admin.from('contact_audit_log').insert(rows)
  if (error) throw error
}

export async function workspaceMemberOptions(input: {
  admin: AdminClient
  workspaceId: string
}) {
  const { data: memberships, error } = await input.admin
    .from('workspace_members')
    .select('user_id,role')
    .eq('workspace_id', input.workspaceId)
    .order('role')
  if (error) throw error
  return Promise.all(
    memberships.map(async (membership) => {
      const { data } = await input.admin.auth.admin.getUserById(
        membership.user_id,
      )
      const user = data.user
      const metadataName =
        typeof user?.user_metadata.name === 'string'
          ? user.user_metadata.name.trim()
          : ''
      return {
        id: membership.user_id,
        role: membership.role,
        name:
          metadataName ||
          user?.email?.split('@')[0] ||
          `Membro ${membership.user_id.slice(0, 6)}`,
      }
    }),
  )
}
