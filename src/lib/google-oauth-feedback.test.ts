import { describe, expect, it } from 'vitest'
import {
  getGoogleOAuthFeedback,
  normalizeGoogleOAuthReason,
} from './google-oauth-feedback'

describe('Google OAuth feedback', () => {
  it('explica como recuperar um access_denied sem acusar falha interna', () => {
    const feedback = getGoogleOAuthFeedback('denied', 'access_denied')

    expect(feedback).toMatchObject({
      tone: 'error',
      title: 'O Google recusou a autorização',
      canRetry: true,
    })
    expect(feedback?.description).toContain('Usuários de teste')
  })

  it('confirma a conexão concluída sem oferecer nova autorização', () => {
    expect(getGoogleOAuthFeedback('connected', null)).toMatchObject({
      tone: 'success',
      canRetry: false,
    })
  })

  it('não reflete erros arbitrários recebidos do provedor', () => {
    const untrusted = '<img src=x onerror=alert(1)>'

    expect(normalizeGoogleOAuthReason(untrusted)).toBe('provider_error')
    expect(
      JSON.stringify(getGoogleOAuthFeedback('denied', untrusted)),
    ).not.toContain(untrusted)
  })

  it('ignora resultados desconhecidos', () => {
    expect(getGoogleOAuthFeedback('javascript:alert(1)', null)).toBeNull()
  })
})
