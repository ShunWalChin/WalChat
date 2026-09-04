export type LeadStatus = 'open' | 'won' | 'lost'
export type RiskBucket = 'em_dia' | 'em_voo' | 'em_risco' | 'critico'
export type ViewMode = 'board' | 'list'
export type SortMode = 'position' | 'next-action' | 'value-desc' | 'recent'
export type ActivityType =
  'note' | 'task' | 'call' | 'meeting' | 'email' | 'link' | 'document'

export type Pipeline = {
  id: string
  name: string
  description: string | null
  is_default: boolean
  vocabulary: Record<string, string>
  settings: Record<string, unknown>
}

export type Stage = {
  id: string
  pipeline_id: string
  name: string
  slug: string
  description: string | null
  position: number
  color: string
  terminal_state: LeadStatus
  requires_human: boolean
  expected_duration_hours: number
}

export type Contact = {
  id: string
  display_name: string | null
  full_name: string | null
  username: string | null
  phone: string | null
  email: string | null
  avatar_url: string | null
  platform: string
  company?: string | null
  job_title?: string | null
}

export type Lead = {
  id: string
  pipelineId: string
  stageId: string
  contactId: string | null
  title: string
  description: string | null
  status: LeadStatus
  lostReason: string | null
  position: number
  valueCents: number | null
  currency: string
  ownerUserId: string | null
  ownerName: string | null
  lastActivityAt: string | null
  nextActionAt: string | null
  expectedCloseDate: string | null
  source: string
  sourceMetadata: Record<string, unknown>
  customFields: Record<string, string | number | boolean | null>
  tags: string[]
  lockVersion: number
  createdAt: string
  updatedAt: string
  contact: Contact | null
  score: {
    probability: number | null
    reason: string | null
    band: 'frio' | 'morno' | 'quente' | null
  } | null
  risk: {
    bucket: RiskBucket
    since: string
  } | null
}

export type Member = { id: string; name: string; role: string }

export type CrmData = {
  pipelines: Pipeline[]
  activePipelineId: string | null
  stages: Stage[]
  leads: Lead[]
  members: Member[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  permissions: { canWrite: boolean; canManagePipelines: boolean }
  summary: {
    open: number
    won: number
    lost: number
    valueCents: number
    weightedValueCents: number
    atRisk: number
    overdue: number
    unassigned: number
  }
}

export type ContactOption = {
  id: string
  name: string
  identity: string
  company?: string | null
}

export type LeadActivity = {
  id: string
  type: string
  payload: Record<string, unknown>
  performedAt: string
  actorName: string
}
