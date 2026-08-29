/** Configuração do provedor de IA e armazenamento opcional de API key por tenant. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { validateAiProviderCredential } from '../../../server/ai-provider-validation.server'
import { aiSettingsSchema } from '../../../server/ai-settings-contract'
import { getServerEnv } from '../../../server/env.server'
import {
  deleteIntegrationCredential,
  getAiApiKey,
  saveIntegrationCredential,
  writeIntegrationAudit,
} from '../../../server/integration-credentials.server'
import { readJsonBody } from '../../../server/request-body.server'

export const Route = createFileRoute('/api/ai/settings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [{ data: settings }, { data: credentials }] = await Promise.all(
            [
              context.supabase
                .from('ai_provider_settings')
                .select('*')
                .eq('workspace_id', context.workspaceId)
                .maybeSingle(),
              context.admin
                .from('integration_credentials')
                .select('provider')
                .eq('workspace_id', context.workspaceId)
                .eq('credential_type', 'api_key'),
            ],
          )
          const env = getServerEnv()
          const provider = settings?.provider ?? 'openai'
          const tenantProviders = new Set(
            (credentials ?? []).map((item) => item.provider),
          )
          return Response.json(
            {
              settings: {
                provider,
                model:
                  settings?.model ??
                  (provider === 'openai'
                    ? env.OPENAI_MODEL
                    : 'gemini-2.5-flash'),
                reasoningEffort: settings?.reasoning_effort ?? 'low',
                responseVerbosity: settings?.response_verbosity ?? 'low',
                maxOutputTokens: settings?.max_output_tokens ?? 500,
                isEnabled: settings?.is_enabled ?? true,
              },
              providers: {
                openai: {
                  configured: Boolean(
                    tenantProviders.has('openai') || env.OPENAI_API_KEY,
                  ),
                  source: tenantProviders.has('openai')
                    ? 'tenant'
                    : env.OPENAI_API_KEY
                      ? 'server'
                      : 'none',
                },
                google: {
                  configured: Boolean(
                    tenantProviders.has('google') ||
                    env.GOOGLE_GENERATIVE_AI_API_KEY,
                  ),
                  source: tenantProviders.has('google')
                    ? 'tenant'
                    : env.GOOGLE_GENERATIVE_AI_API_KEY
                      ? 'server'
                      : 'none',
                },
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao consultar a configuração de IA.',
          )
        }
      },
      PUT: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = aiSettingsSchema.parse(await readJsonBody(request))
          const apiKey = body.removeApiKey
            ? undefined
            : (body.apiKey ??
              (body.isEnabled
                ? await getAiApiKey(context.workspaceId, body.provider)
                : undefined))
          if ((body.apiKey || body.isEnabled) && !apiKey)
            throw new ApiError(
              422,
              `Informe uma API key da ${body.provider === 'openai' ? 'OpenAI' : 'Google Gemini'}.`,
            )
          if (apiKey)
            await validateAiProviderCredential({
              provider: body.provider,
              model: body.model,
              apiKey,
            })
          const { error } = await context.supabase
            .from('ai_provider_settings')
            .upsert({
              workspace_id: context.workspaceId,
              provider: body.provider,
              model: body.model,
              reasoning_effort: body.reasoningEffort,
              response_verbosity: body.responseVerbosity,
              max_output_tokens: body.maxOutputTokens,
              is_enabled: body.isEnabled,
            })
          if (error) throw error
          if (body.apiKey)
            await saveIntegrationCredential({
              workspaceId: context.workspaceId,
              provider: body.provider,
              credentialType: 'api_key',
              scopeKey: 'workspace',
              value: body.apiKey,
              metadata: {
                model: body.model,
                validatedAt: new Date().toISOString(),
              },
            })
          if (body.removeApiKey)
            await deleteIntegrationCredential({
              workspaceId: context.workspaceId,
              provider: body.provider,
              credentialType: 'api_key',
              scopeKey: 'workspace',
            })
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: body.provider,
            action: 'ai_settings_updated',
            status: 'success',
            details: {
              model: body.model,
              keyUpdated: Boolean(body.apiKey),
              providerValidated: Boolean(apiKey),
            },
          })
          return Response.json({ ok: true, providerValidated: Boolean(apiKey) })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao salvar a configuração de IA.',
          )
        }
      },
    },
  },
})
