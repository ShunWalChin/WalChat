import { describe, expect, it } from 'vitest'
import {
  contactDisplayName,
  eligibilityPresentation,
  normalizePhone,
  nullableText,
} from './contacts-crm.server'

describe('contacts CRM', () => {
  it('normaliza textos opcionais sem persistir espaços vazios', () => {
    expect(nullableText('  Criador BR  ')).toBe('Criador BR')
    expect(nullableText('   ')).toBeNull()
    expect(nullableText(undefined)).toBeNull()
  })

  it('normaliza telefone e preserva o prefixo internacional', () => {
    expect(normalizePhone('+55 (11) 99999-1234')).toBe('+5511999991234')
    expect(normalizePhone('31999991234')).toBe('31999991234')
    expect(() => normalizePhone('123')).toThrow(
      'Telefone deve conter entre 8 e 15 dígitos.',
    )
  })

  it('prioriza o nome editável sem perder o fallback do provedor', () => {
    expect(
      contactDisplayName({
        display_name: 'Nome no CRM',
        full_name: 'Nome Meta',
        username: 'criador',
      }),
    ).toBe('Nome no CRM')
    expect(contactDisplayName({ full_name: null, username: 'criador' })).toBe(
      '@criador',
    )
  })

  it('traduz todas as políticas de elegibilidade para a UI', () => {
    expect(eligibilityPresentation('standard_24h')).toEqual({
      label: '24h aberta',
      tone: 'green',
    })
    expect(eligibilityPresentation('human_agent_7d').tone).toBe('orange')
    expect(eligibilityPresentation('whatsapp_template').tone).toBe('blue')
    expect(eligibilityPresentation('blocked').tone).toBe('gray')
  })
})
