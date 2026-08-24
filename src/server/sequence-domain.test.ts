import { describe, expect, it } from 'vitest'
import {
  sequenceDefinitionSchema,
  sequenceDurationSeconds,
  sequenceValidationSummary,
} from './sequence-domain'

describe('sequence domain', () => {
  it('valida mensagens e calcula o tempo total', () => {
    const sequence = sequenceDefinitionSchema.parse({
      name: 'Boas-vindas',
      isActive: true,
      steps: [
        { kind: 'typing', delaySeconds: 2 },
        { kind: 'text', content: 'Oi', delaySeconds: 0 },
        { kind: 'delay', delaySeconds: 3_600 },
      ],
    })
    expect(sequenceDurationSeconds(sequence.steps)).toBe(3_602)
    expect(sequenceValidationSummary(sequence.steps)).toMatchObject({
      steps: 3,
      sendingSteps: 1,
      complianceRecheckedPerSend: true,
    })
  })

  it('rejeita fluxo sem mensagem e mídia sem URL', () => {
    expect(() =>
      sequenceDefinitionSchema.parse({
        name: 'Inválida',
        steps: [{ kind: 'delay', delaySeconds: 60 }],
      }),
    ).toThrow()
    expect(() =>
      sequenceDefinitionSchema.parse({
        name: 'Inválida',
        steps: [{ kind: 'media', delaySeconds: 0 }],
      }),
    ).toThrow()
  })
})
