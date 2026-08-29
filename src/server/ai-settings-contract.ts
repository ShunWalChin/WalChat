/** Contrato validado da configuração de IA recebida pela rota privada. */
import { z } from 'zod'

export const aiSettingsSchema = z
  .object({
    provider: z.enum(['openai', 'google']),
    model: z.string().min(2).max(80),
    reasoningEffort: z.enum(['none', 'low', 'medium', 'high']),
    responseVerbosity: z.enum(['low', 'medium', 'high']),
    maxOutputTokens: z.number().int().min(100).max(2_000),
    isEnabled: z.boolean(),
    apiKey: z.string().trim().min(20).max(500).optional(),
    removeApiKey: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.apiKey && value.removeApiKey)
      context.addIssue({
        code: 'custom',
        path: ['apiKey'],
        message: 'Não é possível salvar e remover a chave ao mesmo tempo.',
      })
    if (value.provider === 'openai' && !value.model.startsWith('gpt-'))
      context.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'Selecione um modelo OpenAI válido.',
      })
    if (value.provider === 'google' && !value.model.startsWith('gemini-'))
      context.addIssue({
        code: 'custom',
        path: ['model'],
        message: 'Selecione um modelo Gemini válido.',
      })
  })
