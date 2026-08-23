/** Validação server-only das variáveis; impede que secrets entrem no bundle web. */
import '@tanstack/react-start/server-only'
import { z } from 'zod'

const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  REDIS_URL: z.string().optional(),
  // Instagram Login e WhatsApp/Facebook Login possuem App IDs e secrets distintos.
  META_INSTAGRAM_APP_ID: z.string().optional(),
  META_INSTAGRAM_APP_SECRET: z.string().min(8).optional(),
  META_INSTAGRAM_VERIFY_TOKEN: z.string().min(8).optional(),
  META_WHATSAPP_APP_ID: z.string().optional(),
  META_WHATSAPP_APP_SECRET: z.string().min(8).optional(),
  META_WHATSAPP_VERIFY_TOKEN: z.string().min(8).optional(),
  // Variáveis legadas preservadas como fallback durante a migração.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().min(8).optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_PUBLISH_TOKEN: z.string().optional(),
  META_VERIFY_TOKEN: z.string().min(8).optional(),
  META_OAUTH_REDIRECT_URI: z.string().url().optional(),
  META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v25.0'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(8).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.6-sol'),
  OPENAI_PROJECT: z.string().optional(),
  OPENAI_ORGANIZATION: z.string().optional(),
  N8N_BASE_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().min(8).optional(),
  N8N_WEBHOOK_SIGNING_SECRET: z.string().min(24).optional(),
  N8N_ALLOWED_HOSTS: z.string().optional(),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(32).optional(),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  DEMO_MODE: z.enum(['true', 'false']).default('true'),
})

/** Lê e valida o ambiente a cada processo, aplicando defaults seguros para o MVP. */
export function getServerEnv() {
  return serverEnvSchema.parse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_PUBLISHABLE_KEY:
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.VITE_SUPABASE_ANON_KEY,
    REDIS_URL: process.env.REDIS_URL,
    META_INSTAGRAM_APP_ID: process.env.META_INSTAGRAM_APP_ID,
    META_INSTAGRAM_APP_SECRET: process.env.META_INSTAGRAM_APP_SECRET,
    META_INSTAGRAM_VERIFY_TOKEN: process.env.META_INSTAGRAM_VERIFY_TOKEN,
    META_WHATSAPP_APP_ID: process.env.META_WHATSAPP_APP_ID,
    META_WHATSAPP_APP_SECRET: process.env.META_WHATSAPP_APP_SECRET,
    META_WHATSAPP_VERIFY_TOKEN: process.env.META_WHATSAPP_VERIFY_TOKEN,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PUBLISH_TOKEN: process.env.META_PUBLISH_TOKEN,
    META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN,
    META_OAUTH_REDIRECT_URI: process.env.META_OAUTH_REDIRECT_URI,
    META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID:
      process.env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID,
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_PROJECT: process.env.OPENAI_PROJECT,
    OPENAI_ORGANIZATION: process.env.OPENAI_ORGANIZATION,
    N8N_BASE_URL: process.env.N8N_BASE_URL,
    N8N_API_KEY: process.env.N8N_API_KEY,
    N8N_WEBHOOK_SIGNING_SECRET: process.env.N8N_WEBHOOK_SIGNING_SECRET,
    N8N_ALLOWED_HOSTS: process.env.N8N_ALLOWED_HOSTS,
    CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
    APP_ORIGIN: process.env.APP_ORIGIN,
    DEMO_MODE: process.env.DEMO_MODE,
  })
}

type ServerEnv = ReturnType<typeof getServerEnv>

/** Resolve o aplicativo específico do Instagram, com fallback legado sem expor secrets. */
export function getInstagramAppConfig(env: ServerEnv = getServerEnv()) {
  return {
    appId: env.META_INSTAGRAM_APP_ID ?? env.META_APP_ID,
    appSecret: env.META_INSTAGRAM_APP_SECRET ?? env.META_APP_SECRET,
    verifyToken: env.META_INSTAGRAM_VERIFY_TOKEN ?? env.META_VERIFY_TOKEN,
  }
}

/** Resolve o aplicativo principal usado pelo WhatsApp Embedded Signup. */
export function getWhatsAppAppConfig(env: ServerEnv = getServerEnv()) {
  return {
    appId: env.META_WHATSAPP_APP_ID ?? env.META_APP_ID,
    appSecret: env.META_WHATSAPP_APP_SECRET ?? env.META_APP_SECRET,
    verifyToken: env.META_WHATSAPP_VERIFY_TOKEN ?? env.META_VERIFY_TOKEN,
  }
}

/** Lista secrets Meta únicos para callbacks que podem ser emitidos por ambos os apps. */
export function getMetaAppSecrets(env: ServerEnv = getServerEnv()) {
  return [
    getInstagramAppConfig(env).appSecret,
    getWhatsAppAppConfig(env).appSecret,
  ].filter((secret, index, secrets): secret is string =>
    Boolean(secret && secrets.indexOf(secret) === index),
  )
}
