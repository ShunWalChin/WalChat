import type { Contact, Lead, LeadStatus, Stage } from './types'

export function positionBeforeLead(
  leads: Lead[],
  target: Lead,
  movingLeadId: string,
) {
  const siblings = leads
    .filter(
      (lead) => lead.stageId === target.stageId && lead.id !== movingLeadId,
    )
    .sort((left, right) => left.position - right.position)
  const targetIndex = siblings.findIndex((lead) => lead.id === target.id)
  const previous = targetIndex > 0 ? siblings[targetIndex - 1] : null
  if (!previous) return Math.max(0, target.position / 2)
  const midpoint = (previous.position + target.position) / 2
  return midpoint === target.position
    ? Math.max(0, target.position - 0.5)
    : midpoint
}

export function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).slice(0, 30)
}

export function leadContactName(lead: Lead) {
  return (
    lead.contact?.display_name ??
    lead.contact?.full_name ??
    lead.contact?.username ??
    'Sem contato'
  )
}

export function contactIdentity(contact: Contact | null) {
  if (!contact) return 'Sem contato vinculado'
  return contact.email ?? contact.phone ?? contact.username ?? contact.platform
}

export function scoreTone(
  band: 'frio' | 'morno' | 'quente' | null | undefined,
) {
  if (band === 'quente') return 'green'
  if (band === 'morno') return 'orange'
  return 'gray'
}

export function statusTone(status: LeadStatus) {
  if (status === 'won') return 'green'
  if (status === 'lost') return 'gray'
  return 'blue'
}

export function statusLabel(status: LeadStatus) {
  if (status === 'won') return 'Ganho'
  if (status === 'lost') return 'Perdido'
  return 'Em aberto'
}

export function stageTypeLabel(status: LeadStatus) {
  if (status === 'won') return 'Etapa de ganho'
  if (status === 'lost') return 'Etapa de perda'
  return 'Em andamento'
}

export function durationLabel(hours: number) {
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'dia' : 'dias'}`
}

export function textPayload(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : ''
}

export function isOverdue(value: string | null) {
  return Boolean(value && Date.parse(value) < Date.now())
}

export function toLocalInput(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

export function money(cents: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(
    cents / 100,
  )
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function longDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function dateOnly(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
    new Date(year, month - 1, day),
  )
}

export function firstOpenStage(stages: Stage[]) {
  return stages.find((stage) => stage.terminal_state === 'open') ?? null
}
