import { afterEach, describe, expect, it } from 'vitest'
import { getServerEnv } from './env.server'

/**
 * Uma variável escrita sem valor não pode derrubar o processo.
 *
 * O caso real: alguém abre o `.env.production` para preparar uma integração,
 * escreve `GOOGLE_CLIENT_SECRET=` e sai para buscar o valor. Sem este
 * tratamento, o próximo boot morre na validação — e a mensagem fala de
 * comprimento mínimo, não de linha em branco. Escrever a chave sem o valor tem
 * exatamente o mesmo significado de não a ter.
 */
describe('variáveis de ambiente em branco', () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  it('aceita segredo escrito sem valor', () => {
    process.env.GOOGLE_CLIENT_SECRET = ''
    expect(() => getServerEnv()).not.toThrow()
    expect(getServerEnv().GOOGLE_CLIENT_SECRET).toBeUndefined()
  })

  it('aceita URL escrita sem valor', () => {
    // `z.string().url()` recusa string vazia com uma mensagem sobre formato,
    // que não ajuda em nada quem só deixou a linha pela metade.
    process.env.SUPABASE_URL = ''
    process.env.N8N_BASE_URL = '   '
    expect(() => getServerEnv()).not.toThrow()
    expect(getServerEnv().N8N_BASE_URL).toBeUndefined()
  })

  it('cai no padrão quando a variável com default vem vazia', () => {
    process.env.APP_ORIGIN = ''
    expect(getServerEnv().APP_ORIGIN).toBe('http://localhost:3000')
  })

  it('não mexe em valor de verdade', () => {
    process.env.GOOGLE_CLIENT_ID = 'meu-client-id.apps.googleusercontent.com'
    expect(getServerEnv().GOOGLE_CLIENT_ID).toBe(
      'meu-client-id.apps.googleusercontent.com',
    )
  })

  it('continua recusando um valor curto de verdade', () => {
    // O endurecimento não pode virar permissividade: um segredo curto ainda é
    // um erro de configuração, e precisa aparecer.
    process.env.GOOGLE_CLIENT_SECRET = 'abc'
    expect(() => getServerEnv()).toThrow()
  })
})
