/**
 * Contrato do pipeline comercial, compartilhado entre servidor e interface.
 *
 * Fica isolado do `.server.ts` porque o editor também precisa dele; um contrato
 * duplicado seria a primeira coisa a divergir.
 */
import { z } from 'zod'

export const CRM_LEAD_STATUSES = ['open', 'won', 'lost'] as const
export const CRM_RISK_BUCKETS = [
  'em_dia',
  'em_voo',
  'em_risco',
  'critico',
] as const

const nullableUuid = z.union([z.uuid(), z.null()]).optional()
const nullableDate = z
  .union([z.iso.datetime({ offset: true }), z.literal(''), z.null()])
  .optional()
const customFieldValue = z.union([
  z.string().trim().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
const customFields = z
  .record(z.string().trim().min(1).max(60), customFieldValue)
  .refine((value) => Object.keys(value).length <= 30, {
    message: 'Use no máximo 30 atributos personalizados.',
  })
const externalAssetUrl = z
  .url()
  .max(1200)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Use uma URL HTTP ou HTTPS.',
  })

export const createCrmLeadSchema = z.object({
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  contactId: nullableUuid,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3000).nullable().optional(),
  valueCents: z.number().int().min(0).max(9_000_000_000).nullable().optional(),
  ownerUserId: nullableUuid,
  expectedCloseDate: z
    .union([z.iso.date(), z.literal(''), z.null()])
    .optional(),
  nextActionAt: nullableDate,
  source: z.string().trim().min(2).max(60).default('manual'),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  customFields: customFields.default({}),
})

export const moveCrmLeadSchema = z.object({
  stageId: z.uuid(),
  position: z.number().finite().min(0).max(1_000_000_000),
  expectedLockVersion: z.number().int().positive(),
  lostReason: z.string().trim().min(2).max(240).nullable().optional(),
})

export const updateCrmLeadSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(3000).nullable().optional(),
    contactId: nullableUuid,
    ownerUserId: nullableUuid,
    valueCents: z
      .number()
      .int()
      .min(0)
      .max(9_000_000_000)
      .nullable()
      .optional(),
    expectedCloseDate: z
      .union([z.iso.date(), z.literal(''), z.null()])
      .optional(),
    nextActionAt: nullableDate,
    source: z.string().trim().min(2).max(60).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    customFields: customFields.optional(),
    status: z.enum(CRM_LEAD_STATUSES).optional(),
    lostReason: z.string().trim().min(2).max(240).nullable().optional(),
    expectedLockVersion: z.number().int().positive(),
  })
  .refine(
    (value) => value.status !== 'lost' || Boolean(value.lostReason?.trim()),
    { message: 'Informe o motivo da perda.', path: ['lostReason'] },
  )

export const createPipelineSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
})

export const updatePipelineSchema = createPipelineSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos uma alteração.',
  })

export const createCrmStageSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  terminalState: z.enum(CRM_LEAD_STATUSES).default('open'),
  requiresHuman: z.boolean().default(false),
  expectedDurationHours: z.number().finite().min(1).max(8_760),
})

export const updateCrmStageSchema = createCrmStageSchema
  .partial()
  .extend({ stageId: z.uuid() })
  .refine((value) => Object.keys(value).length > 1, {
    message: 'Informe ao menos uma alteração na etapa.',
  })

export const reorderCrmStagesSchema = z.object({
  stageIds: z.array(z.uuid()).min(2).max(30),
})

export const archiveCrmStageSchema = z.object({ stageId: z.uuid() })

export const CRM_ACTIVITY_TYPES = [
  'note',
  'task',
  'call',
  'meeting',
  'email',
  'link',
  'document',
] as const

export const createCrmActivitySchema = z
  .object({
    activityType: z.enum(CRM_ACTIVITY_TYPES),
    title: z.string().trim().max(160).nullable().optional(),
    body: z.string().trim().max(3000).nullable().optional(),
    url: z.union([externalAssetUrl, z.literal(''), z.null()]).optional(),
    dueAt: nullableDate,
  })

  .superRefine((value, context) => {
    if (value.activityType === 'note' && !value.body) {
      context.addIssue({
        code: 'custom',
        message: 'Escreva a nota.',
        path: ['body'],
      })
    }
    if (
      ['task', 'call', 'meeting', 'email'].includes(value.activityType) &&
      !value.title
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Informe um título.',
        path: ['title'],
      })
    }
    if (
      ['link', 'document'].includes(value.activityType) &&
      (!value.title || !value.url)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Informe o nome e uma URL válida.',
        path: !value.title ? ['title'] : ['url'],
      })
    }
  })

const bulkLeadIds = z.array(z.uuid()).min(1).max(100)
const bulkVersions = z
  .record(z.uuid(), z.number().int().positive())
  .refine((value) => Object.keys(value).length <= 100, {
    message: 'Selecione no máximo 100 leads.',
  })

export const bulkMoveCrmLeadsSchema = z.object({
  leadIds: bulkLeadIds,
  versions: bulkVersions,
  stageId: z.uuid(),
  lostReason: z.string().trim().min(2).max(240).nullable().optional(),
})

export const bulkAssignCrmLeadsSchema = z.object({
  leadIds: bulkLeadIds,
  versions: bulkVersions,
  ownerUserId: z.uuid().nullable(),
})

export const importCrmLeadRowSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3000).nullable().optional(),
  valueCents: z.number().int().min(0).max(9_000_000_000).nullable().optional(),
  source: z.string().trim().min(2).max(60).default('importacao_csv'),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
})

export const importCrmLeadsSchema = z.object({
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  rows: z.array(importCrmLeadRowSchema).min(1).max(200),
})

export const createMessageTemplateSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(4000),
  shortcut: z
    .string()
    .trim()
    .regex(/^\/[a-z0-9_-]{1,30}$/)
    .nullable()
    .optional(),
  category: z.string().trim().min(2).max(40).default('geral'),
  shared: z.boolean().default(false),
})

export const updateAttendantSchema = z.object({
  userId: z.uuid(),
  isAvailable: z.boolean(),
  capacity: z.number().int().min(1).max(100),
})

export function slugifyPipelineName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

export function leadStatusForStage(terminalState: string) {
  return terminalState === 'won'
    ? ('won' as const)
    : terminalState === 'lost'
      ? ('lost' as const)
      : ('open' as const)
}

export function classifyCrmRisk(input: {
  lastActivityAt: string | null
  nextActionAt: string | null
  expectedDurationHours: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  const baseline = input.lastActivityAt
    ? new Date(input.lastActivityAt)
    : new Date(0)
  const elapsedHours = Math.max(
    0,
    (now.getTime() - baseline.getTime()) / 3_600_000,
  )
  const hasFutureAction = Boolean(
    input.nextActionAt &&
    new Date(input.nextActionAt).getTime() > now.getTime(),
  )
  const ratio = elapsedHours / Math.max(1, input.expectedDurationHours)

  if (hasFutureAction && ratio < 1.5)
    return { bucket: 'em_voo' as const, elapsedHours, ratio }
  if (ratio >= 2) return { bucket: 'critico' as const, elapsedHours, ratio }
  if (ratio >= 1) return { bucket: 'em_risco' as const, elapsedHours, ratio }
  return { bucket: 'em_dia' as const, elapsedHours, ratio }
}

export function scoreBand(probability: number | null) {
  if (probability === null) return null
  if (probability >= 65) return 'quente' as const
  if (probability >= 35) return 'morno' as const
  return 'frio' as const
}
