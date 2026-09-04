import { describe, expect, it } from 'vitest'
import { parseLeadCsv } from './csv'

describe('importação CSV do CRM', () => {
  it('aceita CSV brasileiro com ponto, vírgula e tags', () => {
    expect(
      parseLeadCsv(
        'Título;Descrição;Valor;Origem;Tags\r\nPlano Pro;Renovação;1.299,90;Indicação;vip|renovação',
      ),
    ).toEqual([
      {
        title: 'Plano Pro',
        description: 'Renovação',
        valueCents: 129_990,
        source: 'Indicação',
        tags: ['vip', 'renovação'],
      },
    ])
  })

  it('preserva vírgula e aspas dentro de célula', () => {
    const [lead] = parseLeadCsv(
      'Oportunidade,Contexto,Valor\n"Plano, anual","Cliente disse ""sim""",100',
    )
    expect(lead.title).toBe('Plano, anual')
    expect(lead.description).toBe('Cliente disse "sim"')
  })

  it('recusa linha sem título e arquivo sem dados', () => {
    expect(() => parseLeadCsv('Título,Valor\n,10')).toThrow('Linha 2')
    expect(() => parseLeadCsv('Título,Valor')).toThrow('ao menos uma linha')
  })
})
