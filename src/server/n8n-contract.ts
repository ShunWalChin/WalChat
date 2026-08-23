/** Contratos versionados da ponte Wal Chat ↔ n8n. */
import { z } from 'zod'

export const N8N_OUTBOUND_EVENT_TYPES = [
  'contact.created',
  'contact.updated',
  'message.received',
  'booking.created',
  'automation.completed',
  'integration.test',
] as const

export const n8nOutboundEventTypeSchema = z.enum(N8N_OUTBOUND_EVENT_TYPES)

const eventSubscriptionsSchema = z
  .array(n8nOutboundEventTypeSchema.exclude(['integration.test']))
  .max(5)
  .default([
    'contact.created',
    'contact.updated',
    'message.received',
    'booking.created',
    'automation.completed',
  ])

export const n8nConfigureSchema = z
  .object({
    name: z.string().trim().min(2).max(80).default('n8n principal'),
    baseUrl: z.string().trim().url().max(2048).optional(),
    apiKey: z.string().trim().min(8).max(4096).optional(),
    outboundWebhookUrl: z.string().trim().url().max(2048).optional(),
    signingSecret: z.string().min(24).max(4096).optional(),
    eventSubscriptions: eventSubscriptionsSchema,
  })
  .strict()

export const n8nTestSchema = z
  .object({ mode: z.enum(['api', 'outbound']) })
  .strict()

export const n8nDispatchSchema = z
  .object({
    eventType: n8nOutboundEventTypeSchema.exclude(['integration.test']),
    payload: z.record(z.string().max(80), z.unknown()),
    deliveryId: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{8,128}$/)
      .optional(),
  })
  .strict()

const contactUpsertData = z
  .object({
    externalId: z.string().trim().min(1).max(160),
    fullName: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().min(7).max(32).optional(),
    company: z.string().trim().max(120).optional(),
    jobTitle: z.string().trim().max(120).optional(),
    lifecycleStage: z
      .enum(['lead', 'engaged', 'customer', 'vip', 'inactive'])
      .optional(),
    leadScore: z.number().int().min(0).max(100).optional(),
    marketingConsent: z.enum(['unknown', 'granted', 'revoked']).optional(),
    customFields: z.record(z.string().max(64), z.unknown()).optional(),
  })
  .strict()

const tagApplyData = z
  .object({
    externalId: z.string().trim().min(1).max(160),
    tagName: z.string().trim().min(1).max(40),
    tagColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .default('#111111'),
  })
  .strict()

const automationExecuteData = z
  .object({
    contactId: z.string().uuid(),
    flowId: z.string().uuid(),
    platform: z.enum(['instagram', 'whatsapp']),
    context: z.record(z.string().max(80), z.unknown()).default({}),
  })
  .strict()

export const n8nInboundEventSchema = z.discriminatedUnion('eventType', [
  z
    .object({
      schemaVersion: z.literal(1),
      eventType: z.literal('contact.upsert'),
      data: contactUpsertData,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      eventType: z.literal('contact.tag.apply'),
      data: tagApplyData,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      eventType: z.literal('automation.execute'),
      data: automationExecuteData,
    })
    .strict(),
])

export type N8nConfigureInput = z.infer<typeof n8nConfigureSchema>
export type N8nInboundEvent = z.infer<typeof n8nInboundEventSchema>
export type N8nOutboundEventType = z.infer<typeof n8nOutboundEventTypeSchema>
