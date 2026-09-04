/** Comandos em massa e importação transacional do CRM. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import {
  bulkAssignCrmLeadsSchema,
  bulkMoveCrmLeadsSchema,
  importCrmLeadsSchema,
} from '../../../server/crm-pipeline-contract'
import { readJsonBody } from '../../../server/request-body.server'

const requestSchema = z.discriminatedUnion('kind', [
  bulkMoveCrmLeadsSchema.extend({ kind: z.literal('move') }),
  bulkAssignCrmLeadsSchema.extend({ kind: z.literal('assign') }),
  importCrmLeadsSchema.extend({ kind: z.literal('import') }),
])

export const Route = createFileRoute('/api/crm/bulk')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const input = requestSchema.parse(await readJsonBody(request))
          const userAgent = request.headers.get('user-agent')

          if (input.kind === 'import') {
            const { data, error } = await context.admin.rpc(
              'crm_import_leads_command',
              {
                target_workspace_id: context.workspaceId,
                actor_user_id: context.user.id,
                target_pipeline_id: input.pipelineId,
                target_stage_id: input.stageId,
                rows: input.rows.map((row) => ({
                  title: row.title,
                  description: row.description ?? null,
                  value_cents: row.valueCents ?? null,
                  source: row.source,
                  tags: row.tags,
                  custom_fields: {},
                })),
                request_user_agent: userAgent,
              },
            )
            if (error?.code === '23514')
              throw new ApiError(
                400,
                'Escolha uma etapa aberta para importar os leads.',
              )
            if (error) throw error
            return Response.json(data, { status: 201 })
          }

          if (Object.keys(input.versions).length !== input.leadIds.length)
            throw new ApiError(
              400,
              'A versão de todos os leads selecionados é obrigatória.',
            )

          const { data, error } = await context.admin.rpc(
            'crm_bulk_update_leads',
            {
              target_workspace_id: context.workspaceId,
              actor_user_id: context.user.id,
              target_lead_ids: input.leadIds,
              target_versions: input.versions,
              command_kind: input.kind,
              target_stage_id: input.kind === 'move' ? input.stageId : null,
              target_owner_id:
                input.kind === 'assign' ? input.ownerUserId : null,
              target_lost_reason:
                input.kind === 'move' ? (input.lostReason ?? null) : null,
              request_user_agent: userAgent,
            },
          )
          if (error?.code === '40001')
            throw new ApiError(
              409,
              'Um dos leads mudou. Atualize a lista antes de repetir a ação.',
            )
          if (error?.code === '23514')
            throw new ApiError(
              422,
              'A etapa é inválida ou exige um motivo de perda.',
            )
          if (error?.code === '23503')
            throw new ApiError(400, 'O responsável não pertence ao workspace.')
          if (error) throw error
          return Response.json(data)
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao executar a ação em massa.')
        }
      },
    },
  },
})
