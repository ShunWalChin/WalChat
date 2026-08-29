/** Fontes de captação que transformam POSTs externos em leads do pipeline. */
import { createHash, randomBytes } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { writeCrmAudit } from '../../server/crm-pipeline.server'
import { readJsonBody } from '../../server/request-body.server'

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  fieldMapping: z
    .record(z.string().max(40), z.string().trim().min(1).max(80))
    .default({}),
})

export const Route = createFileRoute('/api/webhook-sources')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [sourcesResult, capturesResult, pipelinesResult, stagesResult] =
            await Promise.all([
              context.admin
                .from('webhook_sources')
                .select(
                  'id,name,pipeline_id,stage_id,field_mapping,is_active,last_received_at,created_at,updated_at',
                )
                .eq('workspace_id', context.workspaceId)
                .order('created_at', { ascending: false }),
              context.admin
                .from('webhook_lead_captures')
                .select(
                  'id,source_id,lead_id,status,error_code,received_at,processed_at',
                )
                .eq('workspace_id', context.workspaceId)
                .order('received_at', { ascending: false })
                .limit(100),
              context.admin
                .from('crm_pipelines')
                .select('id,name')
                .eq('workspace_id', context.workspaceId)
                .is('archived_at', null)
                .order('position'),
              context.admin
                .from('crm_stages')
                .select('id,pipeline_id,name,terminal_state')
                .eq('workspace_id', context.workspaceId)
                .is('archived_at', null)
                .order('position'),
            ])
          for (const result of [
            sourcesResult,
            capturesResult,
            pipelinesResult,
            stagesResult,
          ])
            if (result.error) throw result.error
          const origin = new URL(request.url).origin
          const sources = sourcesResult.data ?? []
          const captures = capturesResult.data ?? []
          return Response.json(
            {
              sources: sources.map((source) => ({
                ...source,
                endpoint: `${origin}/api/public/webhooks/leads/[token]`,
                received: captures.filter(
                  (capture) => capture.source_id === source.id,
                ).length,
              })),
              captures,
              pipelines: pipelinesResult.data ?? [],
              stages: stagesResult.data ?? [],
              permissions: {
                canManage: context.role === 'owner' || context.role === 'admin',
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar webhooks.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const input = createSchema.parse(await readJsonBody(request))
          const { data: stage, error: stageError } = await context.admin
            .from('crm_stages')
            .select('id,pipeline_id,terminal_state')
            .eq('workspace_id', context.workspaceId)
            .eq('id', input.stageId)
            .eq('pipeline_id', input.pipelineId)
            .maybeSingle()
          if (stageError) throw stageError
          if (!stage || stage.terminal_state !== 'open')
            throw new ApiError(400, 'Escolha uma etapa aberta do pipeline.')
          const token = randomBytes(24).toString('base64url')
          const tokenHash = createHash('sha256').update(token).digest('hex')
          const { data, error } = await context.admin
            .from('webhook_sources')
            .insert({
              workspace_id: context.workspaceId,
              name: input.name,
              token_hash: tokenHash,
              pipeline_id: input.pipelineId,
              stage_id: input.stageId,
              field_mapping: input.fieldMapping,
              created_by_user_id: context.user.id,
            })
            .select('id')
            .single()
          if (error?.code === '23505')
            throw new ApiError(409, 'Já existe uma fonte com este nome.')
          if (error) throw error
          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action: 'webhook_source_created',
            resourceType: 'webhook_source',
            resourceId: data.id,
            changes: { name: input.name, pipelineId: input.pipelineId },
            request,
          })
          return Response.json(
            {
              id: data.id,
              endpoint: `${new URL(request.url).origin}/api/public/webhooks/leads/${token}`,
              warning:
                'Copie agora. O token não será exibido novamente e não deve aparecer em logs.',
            },
            { status: 201 },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar a fonte de webhook.')
        }
      },
    },
  },
})
