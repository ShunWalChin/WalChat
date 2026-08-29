import { describe, expect, it } from 'vitest'
import {
  classifyCrmRisk,
  createCrmLeadSchema,
  leadStatusForStage,
  scoreBand,
  slugifyPipelineName,
  updateCrmLeadSchema,
} from './crm-pipeline-contract'

describe('contrato do CRM avançado', () => {
  it('gera slug estável em português', () => {
    expect(slugifyPipelineName('Vendas & Pós-venda')).toBe('vendas-pos-venda')
  })

  it('exige o motivo ao perder um lead', () => {
    expect(
      updateCrmLeadSchema.safeParse({
        expectedLockVersion: 1,
        status: 'lost',
      }).success,
    ).toBe(false)
  })

  it('aceita a criação mínima de um lead', () => {
    expect(
      createCrmLeadSchema.safeParse({
        pipelineId: 'a3b29f1d-bc18-4a08-a66e-7de8222f19eb',
        stageId: 'd40d9289-99ed-4dc2-9010-64c38a3504b8',
        title: 'Diagnóstico comercial',
      }).success,
    ).toBe(true)
  })

  it('classifica o risco sem depender de IA', () => {
    const now = new Date('2026-08-28T12:00:00.000Z')
    expect(
      classifyCrmRisk({
        lastActivityAt: '2026-08-28T06:00:00.000Z',
        nextActionAt: null,
        expectedDurationHours: 24,
        now,
      }).bucket,
    ).toBe('em_dia')
    expect(
      classifyCrmRisk({
        lastActivityAt: '2026-08-26T00:00:00.000Z',
        nextActionAt: null,
        expectedDurationHours: 24,
        now,
      }).bucket,
    ).toBe('critico')
  })

  it('preserva coerência de status e faixa', () => {
    expect(leadStatusForStage('won')).toBe('won')
    expect(leadStatusForStage('lost')).toBe('lost')
    expect(leadStatusForStage('open')).toBe('open')
    expect(scoreBand(90)).toBe('quente')
    expect(scoreBand(50)).toBe('morno')
    expect(scoreBand(10)).toBe('frio')
    expect(scoreBand(null)).toBeNull()
  })
})
