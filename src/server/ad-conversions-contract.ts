import { z } from 'zod'

const optionalId = z
  .string()
  .trim()
  .regex(/^\d{1,30}$/)
  .optional()

export const adConversionConfigurationSchema = z.discriminatedUnion(
  'provider',
  [
    z
      .object({
        provider: z.literal('google_ads'),
        deliveryMode: z.enum(['direct', 'n8n']).default('direct'),
        customerId: z
          .string()
          .trim()
          .regex(/^\d{10}$/),
        managerCustomerId: z
          .string()
          .trim()
          .regex(/^\d{10}$/)
          .optional(),
        developerToken: z.string().trim().min(8).max(256).optional(),
        defaultCurrency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/)
          .default('BRL'),
      })
      .strict(),
    z
      .object({
        provider: z.literal('meta_capi'),
        deliveryMode: z.enum(['direct', 'n8n']).default('direct'),
        datasetId: z
          .string()
          .trim()
          .regex(/^\d{5,40}$/),
        accessToken: z.string().trim().min(20).max(4096).optional(),
        testEventCode: z.string().trim().min(4).max(120).optional(),
        clearTestEventCode: z.boolean().default(false),
        defaultCurrency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/)
          .default('BRL'),
      })
      .strict(),
  ],
)

export const adConversionRuleSchema = z
  .object({
    id: z.uuid().optional(),
    stageId: z.uuid(),
    name: z.string().trim().min(2).max(120),
    googleEnabled: z.boolean().default(false),
    googleConversionActionId: optionalId,
    metaEnabled: z.boolean().default(false),
    metaEventName: z.string().trim().min(1).max(100).optional(),
    metaActionSource: z
      .enum([
        'website',
        'app',
        'phone_call',
        'chat',
        'email',
        'other',
        'physical_store',
        'business_messaging',
        'system_generated',
      ])
      .default('system_generated'),
    valueMode: z.enum(['lead', 'fixed', 'none']).default('lead'),
    fixedValueCents: z.number().int().min(0).optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/)
      .default('BRL'),
    requireConsent: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.googleEnabled && !value.metaEnabled)
      context.addIssue({
        code: 'custom',
        message: 'Ative ao menos um provedor.',
      })
    if (value.googleEnabled && !value.googleConversionActionId)
      context.addIssue({
        code: 'custom',
        message: 'Informe a ação do Google Ads.',
      })
    if (value.metaEnabled && !value.metaEventName)
      context.addIssue({ code: 'custom', message: 'Informe o evento da Meta.' })
    if (value.valueMode === 'fixed' && value.fixedValueCents == null)
      context.addIssue({ code: 'custom', message: 'Informe o valor fixo.' })
  })

export const adConversionRuleMutationSchema = z.discriminatedUnion(
  'operation',
  [
    z.object({ operation: z.literal('save'), rule: adConversionRuleSchema }),
    z.object({ operation: z.literal('delete'), ruleId: z.uuid() }).strict(),
  ],
)

export const adConversionTestSchema = z
  .object({ provider: z.enum(['google_ads', 'meta_capi']) })
  .strict()

export const adConversionReplaySchema = z.object({ eventId: z.uuid() }).strict()
