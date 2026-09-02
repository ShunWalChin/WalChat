/** Estado sanitizado do pipeline OCI/CAPI por workspace. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import { credentialPresence } from '../../../../server/ad-conversions.server'
import { getServerEnv } from '../../../../server/env.server'

export const Route = createFileRoute('/api/integrations/conversions/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [connections, rules, stages, events] = await Promise.all([
            context.admin
              .from('ad_conversion_connections')
              .select(
                'id,provider,delivery_mode,status,account_id,manager_account_id,account_email,api_version,default_currency,last_validated_at,last_event_at,last_error',
              )
              .eq('workspace_id', context.workspaceId)
              .order('provider'),
            context.admin
              .from('ad_conversion_rules')
              .select('*')
              .eq('workspace_id', context.workspaceId)
              .order('created_at'),
            context.admin
              .from('crm_stages')
              .select(
                'id,pipeline_id,name,terminal_state,position,crm_pipelines!inner(name)',
              )
              .eq('workspace_id', context.workspaceId)
              .is('archived_at', null)
              .order('position'),
            context.admin
              .from('ad_conversion_events')
              .select(
                'id,event_name,status,value_cents,currency,error_code,provider_results,event_time,processed_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('created_at', { ascending: false })
              .limit(20),
          ])
          const error =
            connections.error ?? rules.error ?? stages.error ?? events.error
          if (error) throw error
          const connectionViews = await Promise.all(
            (connections.data ?? []).map(async (connection) => ({
              id: connection.id,
              provider: connection.provider,
              deliveryMode: connection.delivery_mode,
              status: connection.status,
              accountId: connection.account_id,
              managerAccountId: connection.manager_account_id,
              accountEmail: connection.account_email,
              apiVersion: connection.api_version,
              defaultCurrency: connection.default_currency,
              lastValidatedAt: connection.last_validated_at,
              lastEventAt: connection.last_event_at,
              lastError: connection.last_error,
              credentials: await credentialPresence(
                context.workspaceId,
                connection,
              ),
            })),
          )
          const env = getServerEnv()
          return Response.json(
            {
              platform: {
                googleOAuthConfigured: Boolean(
                  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
                ),
                graphVersion: env.META_GRAPH_VERSION,
              },
              permissions: {
                canManage: context.role === 'owner' || context.role === 'admin',
              },
              connections: connectionViews,
              rules: (rules.data ?? []).map((rule) => ({
                id: rule.id,
                stageId: rule.stage_id,
                name: rule.name,
                googleEnabled: rule.google_enabled,
                googleConversionActionId: rule.google_conversion_action_id,
                metaEnabled: rule.meta_enabled,
                metaEventName: rule.meta_event_name,
                metaActionSource: rule.meta_action_source,
                valueMode: rule.value_mode,
                fixedValueCents: rule.fixed_value_cents,
                currency: rule.currency,
                requireConsent: rule.require_consent,
                isActive: rule.is_active,
              })),
              stages: (stages.data ?? []).map((stage) => ({
                id: stage.id,
                pipelineId: stage.pipeline_id,
                name: stage.name,
                terminalState: stage.terminal_state,
                pipelineName: Array.isArray(stage.crm_pipelines)
                  ? stage.crm_pipelines[0]?.name
                  : (stage.crm_pipelines as { name?: string } | null)?.name,
              })),
              recentEvents: events.data ?? [],
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao consultar o rastreamento de conversões.',
          )
        }
      },
    },
  },
})
