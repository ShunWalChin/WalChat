/** Gestão do desenho de um pipeline e de suas etapas por workspace. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import {
  archiveCrmStageSchema,
  createCrmStageSchema,
  reorderCrmStagesSchema,
  slugifyPipelineName,
  updateCrmStageSchema,
  updatePipelineSchema,
} from '../../../../server/crm-pipeline-contract'
import { writeCrmAudit } from '../../../../server/crm-pipeline.server'
import { readJsonBody } from '../../../../server/request-body.server'

const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pipeline-update'), data: updatePipelineSchema }),
  z.object({ kind: z.literal('stage-create'), data: createCrmStageSchema }),
  z.object({ kind: z.literal('stage-update'), data: updateCrmStageSchema }),
  z.object({ kind: z.literal('stages-reorder'), data: reorderCrmStagesSchema }),
  z.object({ kind: z.literal('stage-archive'), data: archiveCrmStageSchema }),
])

export const Route = createFileRoute('/api/crm/pipelines/$pipelineId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const input = requestSchema.parse(await readJsonBody(request))
          const { data: pipeline, error: pipelineError } = await context.admin
            .from('crm_pipelines')
            .select('id,name,description')
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.pipelineId)
            .is('archived_at', null)
            .maybeSingle()
          if (pipelineError) throw pipelineError
          if (!pipeline) throw new ApiError(404, 'Pipeline não encontrado.')

          if (input.kind === 'pipeline-update') {
            if (
              input.data.name !== undefined &&
              slugifyPipelineName(input.data.name).length < 2
            )
              throw new ApiError(400, 'Nome não gera um identificador válido.')
            const changes = {
              ...(input.data.name === undefined
                ? {}
                : {
                    name: input.data.name,
                    slug: slugifyPipelineName(input.data.name),
                  }),
              ...(input.data.description === undefined
                ? {}
                : { description: input.data.description || null }),
              updated_at: new Date().toISOString(),
            }
            const { data: updated, error } = await context.admin
              .from('crm_pipelines')
              .update(changes)
              .eq('workspace_id', context.workspaceId)
              .eq('id', pipeline.id)
              .select('id,name,description')
              .single()
            if (error?.code === '23505')
              throw new ApiError(409, 'Já existe um pipeline com este nome.')
            if (error) throw error
            await audit('pipeline_updated', pipeline.id, {
              before: pipeline,
              after: updated,
            })
            return Response.json(updated)
          }

          const { data: stages, error: stagesError } = await context.admin
            .from('crm_stages')
            .select(
              'id,name,slug,description,position,color,terminal_state,requires_human,expected_duration_hours',
            )
            .eq('workspace_id', context.workspaceId)
            .eq('pipeline_id', pipeline.id)
            .is('archived_at', null)
            .order('position')
          if (stagesError) throw stagesError

          if (input.kind === 'stage-create') {
            const slug = slugifyPipelineName(input.data.name)
            if (slug.length < 2)
              throw new ApiError(
                400,
                'Nome da etapa não gera um identificador.',
              )
            const { data: created, error } = await context.admin
              .from('crm_stages')
              .insert({
                workspace_id: context.workspaceId,
                pipeline_id: pipeline.id,
                name: input.data.name,
                slug,
                description: input.data.description || null,
                color: input.data.color,
                terminal_state: input.data.terminalState,
                requires_human: input.data.requiresHuman,
                expected_duration_hours: input.data.expectedDurationHours,
                position: Number(stages.at(-1)?.position ?? 0) + 1000,
              })
              .select(
                'id,name,description,position,color,terminal_state,requires_human,expected_duration_hours',
              )
              .single()
            if (error?.code === '23505')
              throw new ApiError(409, 'Já existe uma etapa com este nome.')
            if (error) throw error
            await audit('crm_stage_created', created.id, { after: created })
            return Response.json(created, { status: 201 })
          }

          if (input.kind === 'stages-reorder') {
            const received = new Set(input.data.stageIds)
            if (
              received.size !== stages.length ||
              stages.some((stage) => !received.has(stage.id))
            )
              throw new ApiError(
                400,
                'Envie todas as etapas ativas exatamente uma vez.',
              )
            const { error } = await context.admin.rpc(
              'crm_reorder_stages_command',
              {
                target_workspace_id: context.workspaceId,
                actor_user_id: context.user.id,
                target_pipeline_id: pipeline.id,
                target_stage_ids: input.data.stageIds,
                request_user_agent: request.headers.get('user-agent'),
              },
            )
            if (error?.code === '22023')
              throw new ApiError(
                409,
                'As etapas mudaram enquanto você editava. Atualize e tente novamente.',
              )
            if (error) throw error
            return Response.json({ ok: true })
          }

          const stageId = input.data.stageId
          const stage = stages.find((item) => item.id === stageId)
          if (!stage) throw new ApiError(404, 'Etapa não encontrada.')

          const { count: leadCount, error: leadCountError } =
            await context.admin
              .from('crm_leads')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('pipeline_id', pipeline.id)
              .eq('stage_id', stage.id)
          if (leadCountError) throw leadCountError

          if (input.kind === 'stage-archive') {
            if (leadCount)
              throw new ApiError(
                409,
                'Mova os leads desta etapa antes de arquivá-la.',
              )
            if (
              stages.filter(
                (item) => item.terminal_state === stage.terminal_state,
              ).length === 1
            )
              throw new ApiError(
                409,
                'O pipeline precisa manter ao menos uma etapa deste tipo.',
              )
            const { error } = await context.admin
              .from('crm_stages')
              .update({
                archived_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('workspace_id', context.workspaceId)
              .eq('pipeline_id', pipeline.id)
              .eq('id', stage.id)
            if (error) throw error
            await audit('crm_stage_archived', stage.id, { before: stage })
            return Response.json({ ok: true })
          }

          if (
            input.data.terminalState &&
            input.data.terminalState !== stage.terminal_state &&
            leadCount
          )
            throw new ApiError(
              409,
              'Mova os leads antes de alterar o tipo desta etapa.',
            )
          if (
            input.data.terminalState &&
            input.data.terminalState !== stage.terminal_state &&
            stages.filter(
              (item) => item.terminal_state === stage.terminal_state,
            ).length === 1
          )
            throw new ApiError(
              409,
              'O pipeline precisa manter ao menos uma etapa deste tipo.',
            )
          const updatedName = input.data.name
          if (
            updatedName !== undefined &&
            slugifyPipelineName(updatedName).length < 2
          )
            throw new ApiError(400, 'Nome não gera um identificador válido.')
          const changes = {
            ...(updatedName === undefined
              ? {}
              : { name: updatedName, slug: slugifyPipelineName(updatedName) }),
            ...(input.data.description === undefined
              ? {}
              : { description: input.data.description || null }),
            ...(input.data.color === undefined
              ? {}
              : { color: input.data.color }),
            ...(input.data.terminalState === undefined
              ? {}
              : { terminal_state: input.data.terminalState }),
            ...(input.data.requiresHuman === undefined
              ? {}
              : { requires_human: input.data.requiresHuman }),
            ...(input.data.expectedDurationHours === undefined
              ? {}
              : {
                  expected_duration_hours: input.data.expectedDurationHours,
                }),
            updated_at: new Date().toISOString(),
          }
          const { data: updated, error } = await context.admin
            .from('crm_stages')
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('pipeline_id', pipeline.id)
            .eq('id', stage.id)
            .select(
              'id,name,description,position,color,terminal_state,requires_human,expected_duration_hours',
            )
            .single()
          if (error?.code === '23505')
            throw new ApiError(409, 'Já existe uma etapa com este nome.')
          if (error) throw error
          await audit('crm_stage_updated', stage.id, {
            before: stage,
            after: updated,
          })
          return Response.json(updated)

          async function audit(
            action: string,
            resourceId: string,
            auditChanges: Record<string, unknown>,
          ) {
            await writeCrmAudit({
              admin: context.admin,
              workspaceId: context.workspaceId,
              user: context.user,
              action,
              resourceType: 'crm_pipeline',
              resourceId,
              changes: auditChanges,
              request,
            })
          }
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao configurar o pipeline.')
        }
      },
    },
  },
})
