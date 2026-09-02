/** Leitura dos headers de cota por aplicativo da Graph API da Meta. */
import { describe, expect, it } from 'vitest'
import {
  META_APP_USAGE_PAUSE_PERCENT,
  parseAppUsageHeader,
  parseBusinessUseCaseHeader,
} from './meta-app-usage.server'

describe('parseAppUsageHeader', () => {
  it('usa o maior dos três percentuais, que é o que a Meta bloqueia', () => {
    const usage = parseAppUsageHeader(
      '{"call_count":28,"total_cputime":91,"total_time":15}',
    )
    expect(usage).toEqual({
      callCount: 28,
      totalCputime: 91,
      totalTime: 15,
      peak: 91,
    })
  })

  it('trata campo ausente como zero em vez de NaN', () => {
    expect(parseAppUsageHeader('{"call_count":10}')?.peak).toBe(10)
    expect(parseAppUsageHeader('{}')?.peak).toBe(0)
  })

  it('devolve nulo para header ausente ou corrompido', () => {
    expect(parseAppUsageHeader(null)).toBeNull()
    expect(parseAppUsageHeader('')).toBeNull()
    expect(parseAppUsageHeader('não é json')).toBeNull()
    // `null` e array são JSON válido mas não são o formato do header.
    expect(parseAppUsageHeader('null')).toBeNull()
    expect(parseAppUsageHeader('[1,2,3]')).toBeNull()
  })

  it('ignora valor negativo, que só poderia vir de resposta adulterada', () => {
    expect(parseAppUsageHeader('{"call_count":-5}')?.peak).toBe(0)
  })
})

describe('parseBusinessUseCaseHeader', () => {
  it('agrega o pico entre todos os negócios e casos de uso', () => {
    const resultado = parseBusinessUseCaseHeader(
      '{"1":[{"call_count":10,"total_time":20}],"2":[{"call_count":77}]}',
    )
    expect(resultado?.peak).toBe(77)
  })

  it('extrai o tempo de reconquista informado pela Meta', () => {
    const resultado = parseBusinessUseCaseHeader(
      '{"1":[{"call_count":100,"estimated_time_to_regain_access":7}]}',
    )
    expect(resultado?.regainMinutes).toBe(7)
  })

  it('devolve zero de espera quando a Meta não bloqueou', () => {
    const resultado = parseBusinessUseCaseHeader('{"1":[{"call_count":10}]}')
    expect(resultado?.regainMinutes).toBe(0)
  })

  it('sobrevive a formato inesperado sem lançar', () => {
    expect(parseBusinessUseCaseHeader(null)).toBeNull()
    expect(parseBusinessUseCaseHeader('quebrado')).toBeNull()
    expect(parseBusinessUseCaseHeader('{"1":"não é lista"}')?.peak).toBe(0)
    expect(parseBusinessUseCaseHeader('{"1":[null]}')?.peak).toBe(0)
  })
})

describe('limiar de pausa', () => {
  it('deixa folga real antes do teto da Meta', () => {
    expect(META_APP_USAGE_PAUSE_PERCENT).toBeGreaterThan(50)
    expect(META_APP_USAGE_PAUSE_PERCENT).toBeLessThan(100)
  })
})
