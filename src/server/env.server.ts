/** Validação server-only das variáveis; impede que secrets entrem no bundle web. */
import '@tanstack/react-start/server-only'
import { z } from 'zod'

const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  REDIS_URL: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().min(8).optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_PUBLISH_TOKEN: z.string().optional(),
  META_VERIFY_TOKEN: z.string().min(8).optional(),
  META_OAUTH_REDIRECT_URI: z.string().url().optional(),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v25.0'),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.6-sol'),
  OPENAI_PROJECT: z.string().optional(),
  OPENAI_ORGANIZATION: z.string().optional(),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(32).optional(),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  DEMO_MODE: z.enum(['true', 'false']).default('true'),
})

/** Lê e valida o ambiente a cada processo, aplicando defaults seguros para o MVP. */
export function getServerEnv() {
  return serverEnvSchema.parse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    REDIS_URL: process.env.REDIS_URL,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PUBLISH_TOKEN: process.env.META_PUBLISH_TOKEN,
    META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN,
    META_OAUTH_REDIRECT_URI: process.env.META_OAUTH_REDIRECT_URI,
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_PROJECT: process.env.OPENAI_PROJECT,
    OPENAI_ORGANIZATION: process.env.OPENAI_ORGANIZATION,
    CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
    APP_ORIGIN: process.env.APP_ORIGIN,
    DEMO_MODE: process.env.DEMO_MODE,
  })
}
