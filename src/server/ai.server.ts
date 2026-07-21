/** Integração server-only com Gemini e fallback determinístico do modo demo. */
import '@tanstack/react-start/server-only'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { withOptOut } from './compliance'
import { getServerEnv } from './env.server'

type SuggestionInput = {
  agentName?: string
  persona?: string
  knowledge?: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

/**
 * Gera uma resposta curta com no máximo cinco mensagens de contexto.
 * O rodapé de opt-out é aplicado depois do modelo para não depender do prompt.
 */
export async function suggestInstagramReply(input: SuggestionInput) {
  const env = getServerEnv()
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY || env.DEMO_MODE === 'true') {
    return withOptOut(
      'Fechou! Separei tudo por aqui 👊 Me conta qual parte você quer destravar primeiro que eu te ajudo no papo reto.',
    )
  }

  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    system: [
      `Você é ${input.agentName ?? 'um agente do Wal Chat'}, atendente brasileiro no Instagram.`,
      input.persona ?? 'Seja próximo, direto, útil e nunca force uma venda.',
      'Responda em PT-BR, em no máximo 500 caracteres. Não invente informações. Evite promessas absolutas.',
      `Base de conhecimento: ${input.knowledge ?? 'Nenhuma base adicional.'}`,
    ].join('\n'),
    messages: input.history.slice(-5),
    temperature: 0.6,
  })
  return withOptOut(text)
}
