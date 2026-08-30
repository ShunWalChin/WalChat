/**
 * Configuração das boas-vindas ao primeiro contato.
 *
 * A tela salva mensagens; aqui elas viram um fluxo publicado e um gatilho de
 * origem `first_contact`. Reusar o DAG em vez de criar um motor próprio é o que
 * faz a saudação herdar compliance, idempotência e versionamento — e permite
 * abrir a mesma saudação no Automation Studio depois para ramificá-la.
 */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { automationGraphChecksum } from '../../server/automation-engine.server'
import { validateAutomationGraph } from '../../server/automation-graph'
import { assertRateLimit } from '../../server/rate-limit.server'
import { readJsonBody } from '../../server/request-body.server'
import {
  buildWelcomeGraph,
  readWelcomeGraph,
  summarizeWelcome,
  welcomeSettingsSchema,
} from '../../server/welcome-domain'

/** Nome fixo: a saudação é única por workspace e precisa ser reencontrável. */
const WELCOME_FLOW_NAME = 'Boas-vindas ao primeiro contato'

export const Route = createFileRoute('/api/welcome')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const { data: trigger, error } = await context.supabase
            .from('triggers')
            .select(
              'id,is_active,cooldown_hours,first_contact_channels,flow_id',
            )
            .eq('workspace_id', context.workspaceId)
            .eq('source', 'first_contact')
            .maybeSingle()
          if (error) throw error

          // Sem gatilho ainda: devolve o rascunho sugerido em vez de vazio, para
          // a tela abrir com algo utilizável.
          if (!trigger?.flow_id)
            return Response.json({
              configured: false,
              isActive: false,
              channels: ['dm'],
              cooldownHours: 168,
              messages: [
                {
                  text: 'Oi! Que bom ter você por aqui. 👋',
                  delaySeconds: 0,
                  mediaUrl: null,
                },
              ],
            })

          const { data: version, error: versionError } = await context.supabase
            .from('automation_flow_versions')
            .select('graph')
            .eq('workspace_id', context.workspaceId)
            .eq('flow_id', trigger.flow_id)
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (versionError) throw versionError

          const messages = version
            ? readWelcomeGraph(validateAutomationGraph(version.graph))
            : []

          return Response.json(
            {
              configured: true,
              isActive: trigger.is_active,
              channels: trigger.first_contact_channels,
              cooldownHours: trigger.cooldown_hours,
              messages,
              flowId: trigger.flow_id,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao carregar as boas-vindas.')
        }
      },

      PUT: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'welcome-save',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 20,
            windowSeconds: 60,
          })
          const settings = welcomeSettingsSchema.parse(
            await readJsonBody(request),
          )

          // O grafo é validado com a mesma função da publicação normal: uma
          // saudação que não publica seria um recurso que promete e falha.
          const graph = validateAutomationGraph(buildWelcomeGraph(settings))

          const { data: existing, error: existingError } =
            await context.supabase
              .from('triggers')
              .select('id,flow_id')
              .eq('workspace_id', context.workspaceId)
              .eq('source', 'first_contact')
              .maybeSingle()
          if (existingError) throw existingError

          let flowId = existing?.flow_id ?? null
          if (!flowId) {
            const { data: flow, error: flowError } = await context.admin
              .from('automation_flows')
              .insert({
                workspace_id: context.workspaceId,
                name: WELCOME_FLOW_NAME,
                description:
                  'Gerado pela tela de boas-vindas. Pode ser aberto no Automation Studio.',
                draft_graph: graph,
                created_by: context.user.id,
              })
              .select('id')
              .single()
            if (flowError) throw flowError
            flowId = flow.id
          } else {
            const { error: draftError } = await context.admin
              .from('automation_flows')
              .update({ draft_graph: graph })
              .eq('workspace_id', context.workspaceId)
              .eq('id', flowId)
            if (draftError) throw draftError
          }

          const { data: revisionRow, error: revisionError } =
            await context.admin
              .from('automation_flows')
              .select('revision')
              .eq('workspace_id', context.workspaceId)
              .eq('id', flowId)
              .single()
          if (revisionError) throw revisionError

          const { error: publishError } = await context.admin.rpc(
            'publish_automation_flow',
            {
              target_workspace_id: context.workspaceId,
              target_flow_id: flowId,
              expected_revision: revisionRow.revision,
              graph_payload: graph,
              graph_checksum: automationGraphChecksum(graph),
              actor_user_id: context.user.id,
            },
          )
          if (publishError) throw publishError

          // O índice único garante uma saudação por workspace; o upsert aqui
          // mantém a operação idempotente se a tela salvar duas vezes.
          const triggerRow = {
            workspace_id: context.workspaceId,
            name: WELCOME_FLOW_NAME,
            source: 'first_contact' as const,
            keyword: null,
            match_mode: 'contains' as const,
            flow_id: flowId,
            response_text: null,
            sequence_id: null,
            is_active: settings.isActive,
            cooldown_hours: settings.cooldownHours,
            first_contact_channels: settings.channels,
          }
          const { error: triggerError } = existing
            ? await context.admin
                .from('triggers')
                .update(triggerRow)
                .eq('workspace_id', context.workspaceId)
                .eq('id', existing.id)
            : await context.admin.from('triggers').insert(triggerRow)
          if (triggerError) throw triggerError

          return Response.json(
            {
              saved: true,
              flowId,
              summary: summarizeWelcome(settings),
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao salvar as boas-vindas.')
        }
      },

      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          // Desativa em vez de apagar: o fluxo publicado guarda o histórico das
          // execuções, e removê-lo levaria a trilha junto.
          const { error } = await context.admin
            .from('triggers')
            .update({ is_active: false })
            .eq('workspace_id', context.workspaceId)
            .eq('source', 'first_contact')
          if (error) throw error
          return Response.json({ deactivated: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao desativar as boas-vindas.')
        }
      },
    },
  },
})
