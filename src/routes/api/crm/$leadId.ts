/** Atualização otimista de um lead, incluindo movimento entre etapas. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import {
  createCrmActivitySchema,
  leadStatusForStage,
  moveCrmLeadSchema,
  updateCrmLeadSchema,
} from '../../../server/crm-pipeline-contract'
import { workspaceMemberOptions } from '../../../server/contacts-crm.server'
import { readJsonBody } from '../../../server/request-body.server'

const requestSchema = z.discriminatedUnion('kind', [
  moveCrmLeadSchema.extend({ kind: z.literal('move') }),
  updateCrmLeadSchema.extend({ kind: z.literal('update') }),
])

function safeExternalUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().slice(0, 2048)
  } catch {
    return null
  }
}

export const Route = createFileRoute('/api/crm/$leadId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const { data: lead, error: leadError } = await context.admin
            .from('crm_leads')
            .select('id,title,contact_id,lock_version')
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.leadId)
            .maybeSingle()
          if (leadError) throw leadError
          if (!lead) throw new ApiError(404, 'Lead não encontrado.')

          const [activityResult, members, attributionResult] =
            await Promise.all([
              context.admin
                .from('crm_lead_activities')
                .select(
                  'id,activity_type,payload,performed_by_user_id,performed_at,created_at',
                )
                .eq('workspace_id', context.workspaceId)
                .eq('lead_id', lead.id)
                .order('performed_at', { ascending: false })
                .limit(100),
              workspaceMemberOptions({
                admin: context.admin,
                workspaceId: context.workspaceId,
              }),
              lead.contact_id
                ? context.admin
                    .from('contact_ad_attributions')
                    .select(
                      'ctwa_clid,ctwa_source_id,ctwa_source_url,ctwa_source_type,ctwa_headline,ctwa_body,ctwa_media_type,ctwa_received_at',
                    )
                    .eq('workspace_id', context.workspaceId)
                    .eq('contact_id', lead.contact_id)
                    .maybeSingle()
                : Promise.resolve({ data: null, error: null }),
            ])
          if (activityResult.error) throw activityResult.error
          if (attributionResult.error) throw attributionResult.error
          const activities = activityResult.data
          const attribution = attributionResult.data
          const memberNames = new Map(
            members.map((member) => [member.id, member.name]),
          )
          return Response.json(
            {
              lead,
              ctwaAttribution:
                attribution?.ctwa_clid || attribution?.ctwa_source_id
                  ? {
                      hasClickId: Boolean(attribution.ctwa_clid),
                      sourceId: attribution.ctwa_source_id,
                      sourceUrl: safeExternalUrl(attribution.ctwa_source_url),
                      sourceType: attribution.ctwa_source_type,
                      headline: attribution.ctwa_headline,
                      body: attribution.ctwa_body,
                      mediaType: attribution.ctwa_media_type,
                      receivedAt: attribution.ctwa_received_at,
                    }
                  : null,
              activities: activities.map((activity) => ({
                id: activity.id,
                type: activity.activity_type,
                payload: activity.payload ?? {},
                performedAt: activity.performed_at,
                actorName: activity.performed_by_user_id
                  ? (memberNames.get(activity.performed_by_user_id) ?? 'Membro')
                  : 'Sistema',
              })),
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao carregar o lead.')
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const input = requestSchema.parse(await readJsonBody(request))
          const { data: current, error: currentError } = await context.admin
            .from('crm_leads')
            .select(
              'id,pipeline_id,stage_id,contact_id,title,status,owner_user_id,lock_version',
            )
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.leadId)
            .maybeSingle()
          if (currentError) throw currentError
          if (!current) throw new ApiError(404, 'Lead não encontrado.')
          if (current.lock_version !== input.expectedLockVersion)
            throw new ApiError(
              409,
              'Este lead foi alterado por outra pessoa. Atualize o quadro.',
            )

          let changes: Record<string, unknown>
          let activityType: string
          let activityDetails: Record<string, unknown> = {}
          if (input.kind === 'move') {
            const { data: stage, error: stageError } = await context.admin
              .from('crm_stages')
              .select('id,pipeline_id,name,terminal_state')
              .eq('workspace_id', context.workspaceId)
              .eq('id', input.stageId)
              .maybeSingle()
            if (stageError) throw stageError
            if (!stage || stage.pipeline_id !== current.pipeline_id)
              throw new ApiError(400, 'Etapa não pertence a este pipeline.')
            const status = leadStatusForStage(stage.terminal_state)
            const sameStage = stage.id === current.stage_id
            if (!sameStage && status === 'lost' && !input.lostReason)
              throw new ApiError(422, 'Informe o motivo da perda.')
            if (sameStage) {
              changes = {
                position_in_stage: input.position,
                last_activity_at: new Date().toISOString(),
              }
              activityType = 'lead_reordered'
            } else {
              changes = {
                stage_id: input.stageId,
                position_in_stage: input.position,
                status,
                closed_at: status === 'open' ? null : new Date().toISOString(),
                lost_reason: status === 'lost' ? input.lostReason : null,
                last_activity_at: new Date().toISOString(),
              }
              activityType = 'stage_moved'
              activityDetails = {
                fromStageId: current.stage_id,
                toStageId: stage.id,
                toStageName: stage.name,
              }
            }
          } else {
            if (input.contactId) {
              const { count, error } = await context.admin
                .from('contacts')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', context.workspaceId)
                .eq('id', input.contactId)
              if (error) throw error
              if (!count) throw new ApiError(400, 'Contato não encontrado.')
            }
            if (input.ownerUserId) {
              const { count, error } = await context.admin
                .from('workspace_members')
                .select('user_id', { count: 'exact', head: true })
                .eq('workspace_id', context.workspaceId)
                .eq('user_id', input.ownerUserId)
              if (error) throw error
              if (!count)
                throw new ApiError(
                  400,
                  'Responsável não pertence ao workspace.',
                )
            }
            changes = {
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.description === undefined
                ? {}
                : { description: input.description || null }),
              ...(input.contactId === undefined
                ? {}
                : { contact_id: input.contactId }),
              ...(input.ownerUserId === undefined
                ? {}
                : {
                    owner_user_id: input.ownerUserId,
                    assigned_at: input.ownerUserId
                      ? new Date().toISOString()
                      : null,
                  }),
              ...(input.valueCents === undefined
                ? {}
                : { value_cents: input.valueCents }),
              ...(input.expectedCloseDate === undefined
                ? {}
                : { expected_close_date: input.expectedCloseDate || null }),
              ...(input.nextActionAt === undefined
                ? {}
                : { next_action_at: input.nextActionAt || null }),
              ...(input.source === undefined ? {} : { source: input.source }),
              ...(input.tags === undefined ? {} : { tags: input.tags }),
              ...(input.customFields === undefined
                ? {}
                : { custom_fields: input.customFields }),
              ...(input.status === undefined
                ? {}
                : {
                    status: input.status,
                    closed_at:
                      input.status === 'open' ? null : new Date().toISOString(),
                    lost_reason:
                      input.status === 'lost' ? input.lostReason : null,
                  }),
              last_activity_at: new Date().toISOString(),
            }
            activityType = 'lead_updated'
          }

          const { data: updated, error } = await context.admin.rpc(
            'crm_update_lead_command',
            {
              target_workspace_id: context.workspaceId,
              actor_user_id: context.user.id,
              target_lead_id: params.leadId,
              expected_lock_version: input.expectedLockVersion,
              lead_changes: changes,
              activity_type: activityType,
              activity_details: activityDetails,
              request_user_agent: request.headers.get('user-agent'),
            },
          )
          if (error?.code === '40001')
            throw new ApiError(
              409,
              'Este lead mudou durante a edição. Atualize o quadro.',
            )
          if (error) throw error
          return Response.json(updated)
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o lead.')
        }
      },
      POST: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const input = createCrmActivitySchema.parse(
            await readJsonBody(request),
          )
          const { data: lead, error: leadError } = await context.admin
            .from('crm_leads')
            .select('id,contact_id,title')
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.leadId)
            .maybeSingle()
          if (leadError) throw leadError
          if (!lead) throw new ApiError(404, 'Lead não encontrado.')

          const payload = {
            title: input.title || null,
            body: input.body || null,
            url: input.url || null,
            dueAt: input.dueAt || null,
          }
          const { data: activity, error: activityError } =
            await context.admin.rpc('crm_add_activity_command', {
              target_workspace_id: context.workspaceId,
              actor_user_id: context.user.id,
              target_lead_id: lead.id,
              activity_kind: input.activityType,
              activity_payload: payload,
              request_user_agent: request.headers.get('user-agent'),
            })
          if (activityError) throw activityError
          const normalizedActivity = activity as unknown as {
            id: string
            type: string
            payload: Record<string, unknown>
            performedAt: string
          }
          return Response.json(
            {
              ...normalizedActivity,
              actorName: context.user.email ?? 'Usuário atual',
            },
            { status: 201 },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao adicionar ao lead.')
        }
      },
    },
  },
})
