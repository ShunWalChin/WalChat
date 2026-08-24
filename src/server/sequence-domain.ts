import { z } from 'zod'

export const sequenceStepSchema = z
  .object({
    kind: z.enum(['text', 'media', 'typing', 'delay']),
    content: z.string().trim().max(1_000).nullable().optional(),
    mediaUrl: z.url().max(2_000).nullable().optional(),
    delaySeconds: z.number().int().min(0).max(604_800).default(0),
  })
  .strict()
  .superRefine((step, context) => {
    if (step.kind === 'text' && !step.content)
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Bloco de texto precisa de uma mensagem.',
      })
    if (step.kind === 'media' && !step.mediaUrl)
      context.addIssue({
        code: 'custom',
        path: ['mediaUrl'],
        message: 'Bloco de mídia precisa de uma URL HTTPS pública.',
      })
    if (step.kind === 'typing' && step.delaySeconds < 1)
      context.addIssue({
        code: 'custom',
        path: ['delaySeconds'],
        message: 'Defina ao menos um segundo de digitação.',
      })
    if (step.kind === 'delay' && step.delaySeconds < 60)
      context.addIssue({
        code: 'custom',
        path: ['delaySeconds'],
        message: 'Delay precisa ter ao menos um minuto.',
      })
  })

export const sequenceDefinitionSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(1_000).nullable().optional(),
    isActive: z.boolean().default(false),
    steps: z.array(sequenceStepSchema).min(1).max(50),
  })
  .strict()
  .superRefine((sequence, context) => {
    if (!sequence.steps.some((step) => ['text', 'media'].includes(step.kind)))
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Inclua ao menos um bloco que envie texto ou mídia.',
      })
    sequence.steps.forEach((step, index) => {
      if (step.kind === 'media' && sequence.steps[index + 1]?.kind !== 'text')
        context.addIssue({
          code: 'custom',
          path: ['steps', index],
          message:
            'No Instagram, um bloco de mídia deve ser seguido imediatamente por texto com o opt-out.',
        })
    })
  })

export type SequenceStepInput = z.infer<typeof sequenceStepSchema>

export function sequenceDurationSeconds(steps: SequenceStepInput[]) {
  return steps.reduce((total, step) => total + step.delaySeconds, 0)
}

export function sequenceValidationSummary(steps: SequenceStepInput[]) {
  return {
    steps: steps.length,
    sendingSteps: steps.filter((step) => ['text', 'media'].includes(step.kind))
      .length,
    durationSeconds: sequenceDurationSeconds(steps),
    hasOptOutAtRuntime: true,
    complianceRecheckedPerSend: true,
  }
}
