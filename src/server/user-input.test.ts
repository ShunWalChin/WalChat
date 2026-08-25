import { describe, expect, it } from 'vitest'
import { validateUserInput } from './user-input'

function valor(raw: string, expects: Parameters<typeof validateUserInput>[1]) {
  const result = validateUserInput(raw, expects)
  if (!result.valid) throw new Error(`esperava válido, veio ${result.reason}`)
  return result.value
}

function motivo(raw: string, expects: Parameters<typeof validateUserInput>[1]) {
  const result = validateUserInput(raw, expects)
  if (result.valid) throw new Error('esperava inválido')
  return result.reason
}

describe('resposta em texto', () => {
  it('normaliza espaços e mantém o conteúdo', () => {
    expect(valor('  Maria   Silva  ', 'text')).toBe('Maria Silva')
  })

  it('recusa resposta vazia', () => {
    expect(motivo('   ', 'text')).toBe('empty')
    expect(validateUserInput(null, 'text').valid).toBe(false)
  })

  it('recusa resposta acima do limite', () => {
    expect(motivo('x'.repeat(1_001), 'text')).toBe('too_long')
  })
})

describe('e-mail', () => {
  it('aceita e normaliza para caixa baixa', () => {
    expect(valor('  Maria@Exemplo.COM.BR ', 'email')).toBe(
      'maria@exemplo.com.br',
    )
  })

  it('recusa endereço sem domínio completo', () => {
    expect(motivo('maria@exemplo', 'email')).toBe('invalid_email')
    expect(motivo('maria', 'email')).toBe('invalid_email')
    expect(motivo('@exemplo.com', 'email')).toBe('invalid_email')
  })
})

describe('telefone', () => {
  it('guarda só os dígitos', () => {
    expect(valor('(11) 99999-8888', 'phone')).toBe('11999998888')
    expect(valor('+55 11 99999 8888', 'phone')).toBe('5511999998888')
  })

  it('aceita fixo com DDD', () => {
    expect(valor('11 3333-4444', 'phone')).toBe('1133334444')
  })

  it('recusa número curto ou longo demais', () => {
    expect(motivo('99999888', 'phone')).toBe('invalid_phone')
    expect(motivo('1'.repeat(16), 'phone')).toBe('invalid_phone')
  })
})

describe('número', () => {
  it('entende o formato brasileiro', () => {
    expect(valor('1.234,56', 'number')).toBe(1234.56)
    expect(valor('R$ 2.500,00', 'number')).toBe(2500)
  })

  it('entende o formato simples', () => {
    expect(valor('42', 'number')).toBe(42)
    expect(valor('-7.5', 'number')).toBe(-7.5)
  })

  it('recusa texto sem número em vez de virar zero', () => {
    // Number('') é 0: sem checar dígito, "muito caro" viraria orçamento zero.
    expect(motivo('muito caro', 'number')).toBe('invalid_number')
    expect(motivo('R$', 'number')).toBe('invalid_number')
    expect(motivo('-', 'number')).toBe('invalid_number')
  })

  it('não confunde zero legítimo com resposta sem número', () => {
    expect(valor('0', 'number')).toBe(0)
    expect(valor('R$ 0,00', 'number')).toBe(0)
  })
})

describe('data', () => {
  it('aceita DD/MM/AAAA e guarda em ISO', () => {
    expect(valor('05/03/2026', 'date')).toBe('2026-03-05')
    expect(valor('5.3.2026', 'date')).toBe('2026-03-05')
  })

  it('aceita ISO direto', () => {
    expect(valor('2026-03-05', 'date')).toBe('2026-03-05')
  })

  it('recusa data que não existe no calendário', () => {
    // `new Date` deslizaria 31/02 para março em silêncio.
    expect(motivo('31/02/2026', 'date')).toBe('invalid_date')
    expect(motivo('2026-02-31', 'date')).toBe('invalid_date')
    expect(motivo('45/13/2026', 'date')).toBe('invalid_date')
  })

  it('recusa formato desconhecido', () => {
    expect(motivo('amanhã', 'date')).toBe('invalid_date')
    expect(motivo('03/2026', 'date')).toBe('invalid_date')
  })
})
