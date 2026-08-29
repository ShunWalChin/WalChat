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
  leadStatusForStage,
  moveCrmLeadSchema,
  updateCrmLeadSchema,
} from '../../../server/crm-pipeline-contract'
import { writeCrmAudit } from '../../../server/crm-pipeline.server'
import { readJsonBody } from '../../../server/request-body.server'

const requestSchema = z.discriminatedUnion('kind', [
  moveCrmLeadSchema.extend({ kind: z.literal('move') }),
  updateCrmLeadSchema.extend({ kind: z.literal('update') }),
])

export const Route = createFileRoute('/api/crm/$leadId')({
  server: {
    handlers: {
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
            if (status === 'lost' && !input.lostReason)
              throw new ApiError(422, 'Informe o motivo da perda.')
            changes = {
              stage_id: input.stageId,
              position_in_stage: input.position,
              status,
              closed_at: status === 'open' ? null : new Date().toISOString(),
              lost_reason: status === 'lost' ? input.lostReason : null,
              last_activity_at: new Date().toISOString(),
            }
            activityType = 'stage_moved'
          } else {
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
              ...(input.tags === undefined ? {} : { tags: input.tags }),
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

          const { data: updated, error } = await context.admin
            .from('crm_leads')
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.leadId)
            .eq('lock_version', input.expectedLockVersion)
            .select('id,stage_id,status,lock_version,updated_at')
            .maybeSingle()
          if (error) throw error
          if (!updated)
            throw new ApiError(
              409,
              'Este lead mudou durante a edição. Atualize o quadro.',
            )

          const { error: activityError } = await context.admin
            .from('crm_lead_activities')
            .insert({
              workspace_id: context.workspaceId,
              lead_id: current.id,
              contact_id: current.contact_id,
              activity_type: activityType,
              payload: { before: current, after: updated },
              performed_by_user_id: context.user.id,
            })
          if (activityError) throw activityError
          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action: activityType,
            resourceType: 'crm_lead',
            resourceId: current.id,
            changes: { before: current, after: updated },
            request,
          })
          return Response.json(updated)
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o lead.')
        }
      },
    },
  },
})
