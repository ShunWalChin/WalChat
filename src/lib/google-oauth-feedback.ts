export type GoogleOAuthReason = 'access_denied' | 'provider_error'

export type GoogleOAuthFeedback = {
  tone: 'error' | 'success'
  title: string
  description: string
  canRetry: boolean
}

/**
 * Converte erros externos em um vocabulário pequeno e seguro.
 * Nunca devolvemos `error_description` ou qualquer texto controlado pelo
 * provedor para a URL ou para a interface.
 */
export function normalizeGoogleOAuthReason(value: unknown): GoogleOAuthReason {
  return value === 'access_denied' ? 'access_denied' : 'provider_error'
}

export function getGoogleOAuthFeedback(
  result: unknown,
  reason: unknown,
): GoogleOAuthFeedback | null {
  if (result === 'connected')
    return {
      tone: 'success',
      title: 'Google conectado',
      description:
        'Calendar e Tasks foram autorizados. A sincronização inicial já pode ser executada.',
      canRetry: false,
    }

  if (result === 'denied') {
    const normalizedReason = normalizeGoogleOAuthReason(reason)
    if (normalizedReason === 'access_denied')
      return {
        tone: 'error',
        title: 'O Google recusou a autorização',
        description:
          'Se você não cancelou, a conta pode não estar em Usuários de teste do projeto OAuth. Libere a conta ou publique e verifique o app antes de tentar novamente.',
        canRetry: true,
      }

    return {
      tone: 'error',
      title: 'Conexão Google não autorizada',
      description:
        'A autorização foi cancelada ou bloqueada. Confira a conta, os Usuários de teste e a tela de consentimento antes de repetir.',
      canRetry: true,
    }
  }

  if (result === 'error')
    return {
      tone: 'error',
      title: 'Não foi possível concluir a conexão',
      description:
        'Confira a URI de redirecionamento e a configuração OAuth do Google. Depois, inicie uma nova autorização.',
      canRetry: true,
    }

  return null
}
