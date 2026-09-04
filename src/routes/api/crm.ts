/** Pipeline comercial nativo: board, criação de leads e pipelines por workspace. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import {
  createCrmLeadSchema,
  createPipelineSchema,
  slugifyPipelineName,
} from '../../server/crm-pipeline-contract'
import { workspaceMemberOptions } from '../../server/contacts-crm.server'
import { readJsonBody } from '../../server/request-body.server'

const querySchema = z.object({
  pipelineId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(20).max(200).default(100),
  q: z.string().trim().max(160).default(''),
  owner: z
    .union([z.uuid(), z.literal('unassigned'), z.literal('all')])
    .default('all'),
  risk: z
    .enum(['em_dia', 'em_voo', 'em_risco', 'critico', 'all'])
    .default('all'),
  status: z.enum(['open', 'won', 'lost', 'all']).default('all'),
  tag: z.string().trim().max(40).default('all'),
  sort: z
    .enum(['position', 'next-action', 'value-desc', 'recent'])
    .default('position'),
})
const createRequestSchema = z.discriminatedUnion('kind', [
  createCrmLeadSchema.extend({ kind: z.literal('lead') }),
  createPipelineSchema.extend({ kind: z.literal('pipeline') }),
])

export const Route = createFileRoute('/api/crm')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const url = new URL(request.url)
          const query = querySchema.parse({
            pipelineId: url.searchParams.get('pipelineId') ?? undefined,
            page: url.searchParams.get('page') ?? undefined,
            pageSize: url.searchParams.get('pageSize') ?? undefined,
            q: url.searchParams.get('q') ?? undefined,
            owner: url.searchParams.get('owner') ?? undefined,
            risk: url.searchParams.get('risk') ?? undefined,
            status: url.searchParams.get('status') ?? undefined,
            tag: url.searchParams.get('tag') ?? undefined,
            sort: url.searchParams.get('sort') ?? undefined,
          })
          const { data: pipelines, error: pipelinesError } = await context.admin
            .from('crm_pipelines')
            .select(
              'id,name,slug,description,is_default,position,vocabulary,settings,archived_at',
            )
            .eq('workspace_id', context.workspaceId)
            .is('archived_at', null)
            .order('position')
          if (pipelinesError) throw pipelinesError
          const activePipeline = query.pipelineId
            ? pipelines.find((pipeline) => pipeline.id === query.pipelineId)
            : (pipelines.find((pipeline) => pipeline.is_default) ??
              pipelines[0])
          if (query.pipelineId && !activePipeline)
            throw new ApiError(404, 'Pipeline não encontrado neste workspace.')

          const [stagesResult, members] = activePipeline
            ? await Promise.all([
                context.admin
                  .from('crm_stages')
                  .select(
                    'id,pipeline_id,name,slug,description,position,color,terminal_state,requires_human,expected_duration_hours',
                  )
                  .eq('workspace_id', context.workspaceId)
                  .eq('pipeline_id', activePipeline.id)
                  .is('archived_at', null)
                  .order('position'),
                workspaceMemberOptions({
                  admin: context.admin,
                  workspaceId: context.workspaceId,
                }),
              ])
            : [
                { data: [], error: null },
                await workspaceMemberOptions({
                  admin: context.admin,
                  workspaceId: context.workspaceId,
                }),
              ]
          if (stagesResult.error) throw stagesResult.error
          const emptySummary = {
            open: 0,
            won: 0,
            lost: 0,
            valueCents: 0,
            weightedValueCents: 0,
            atRisk: 0,
            overdue: 0,
            unassigned: 0,
          }
          const [leadPageResult, summaryResult] = activePipeline
            ? await Promise.all([
                context.admin.rpc('crm_list_leads', {
                  target_workspace_id: context.workspaceId,
                  target_pipeline_id: activePipeline.id,
                  target_page: query.page,
                  target_page_size: query.pageSize,
                  target_query: query.q || null,
                  target_owner_id:
                    query.owner !== 'all' && query.owner !== 'unassigned'
                      ? query.owner
                      : null,
                  target_unassigned: query.owner === 'unassigned',
                  target_status: query.status === 'all' ? null : query.status,
                  target_risk: query.risk === 'all' ? null : query.risk,
                  target_tag: query.tag === 'all' ? null : query.tag,
                  target_sort: query.sort,
                }),
                context.admin.rpc('crm_pipeline_summary', {
                  target_workspace_id: context.workspaceId,
                  target_pipeline_id: activePipeline.id,
                }),
              ])
            : [
                {
                  data: {
                    items: [],
                    total: 0,
                    page: 1,
                    pageSize: query.pageSize,
                  },
                  error: null,
                },
                { data: emptySummary, error: null },
              ]
          if (leadPageResult.error) throw leadPageResult.error
          if (summaryResult.error) throw summaryResult.error
          const leadPage = leadPageResult.data as unknown as {
            items: Array<
              Record<string, unknown> & { ownerUserId: string | null }
            >
            total: number
            page: number
            pageSize: number
          }
          const memberNames = new Map(
            members.map((member) => [member.id, member.name]),
          )
          const normalizedLeads = leadPage.items.map((lead) => ({
            ...lead,
            ownerName: lead.ownerUserId
              ? (memberNames.get(lead.ownerUserId) ?? 'Membro')
              : null,
          }))

          return Response.json(
            {
              pipelines,
              activePipelineId: activePipeline?.id ?? null,
              stages: stagesResult.data,
              leads: normalizedLeads,
              members,
              pagination: {
                page: Number(leadPage.page),
                pageSize: Number(leadPage.pageSize),
                total: Number(leadPage.total),
                totalPages: Math.max(
                  1,
                  Math.ceil(Number(leadPage.total) / Number(leadPage.pageSize)),
                ),
              },
              permissions: {
                canWrite: context.role !== 'viewer',
                canManagePipelines:
                  context.role === 'owner' || context.role === 'admin',
              },
              summary: summaryResult.data ?? emptySummary,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar o pipeline.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const input = createRequestSchema.parse(await readJsonBody(request))
          if (input.kind === 'pipeline') {
            if (context.role === 'agent')
              throw new ApiError(403, 'Apenas gestores criam pipelines.')
            const slug = slugifyPipelineName(input.name)
            if (slug.length < 2)
              throw new ApiError(400, 'Nome não gera um identificador válido.')
            const { data: pipeline, error } = await context.admin.rpc(
              'crm_create_pipeline_command',
              {
                target_workspace_id: context.workspaceId,
                actor_user_id: context.user.id,
                pipeline_data: {
                  name: input.name,
                  slug,
                  description: input.description || null,
                },
                request_user_agent: request.headers.get('user-agent'),
              },
            )
            if (error?.code === '23505')
              throw new ApiError(409, 'Já existe um pipeline com este nome.')
            if (error) throw error
            return Response.json({ id: pipeline.id }, { status: 201 })
          }

          const { data: lead, error } = await context.admin.rpc(
            'crm_create_lead_command',
            {
              target_workspace_id: context.workspaceId,
              actor_user_id: context.user.id,
              lead_data: {
                pipeline_id: input.pipelineId,
                stage_id: input.stageId,
                contact_id: input.contactId ?? null,
                title: input.title,
                description: input.description || null,
                value_cents: input.valueCents ?? null,
                owner_user_id: input.ownerUserId ?? null,
                expected_close_date: input.expectedCloseDate || null,
                next_action_at: input.nextActionAt || null,
                source: input.source,
                custom_fields: input.customFields,
                tags: input.tags,
              },
              request_user_agent: request.headers.get('user-agent'),
            },
          )
          if (error?.code === '23514')
            throw new ApiError(400, 'Escolha uma etapa aberta deste pipeline.')
          if (error?.code === '23503')
            throw new ApiError(
              400,
              'Contato ou responsável não pertence ao workspace.',
            )
          if (error) throw error
          return Response.json(lead, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar o item do CRM.')
        }
      },
    },
  },
})
