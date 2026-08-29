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
  scoreBand,
  slugifyPipelineName,
} from '../../server/crm-pipeline-contract'
import { writeCrmAudit } from '../../server/crm-pipeline.server'
import { workspaceMemberOptions } from '../../server/contacts-crm.server'
import { readJsonBody } from '../../server/request-body.server'

const querySchema = z.object({ pipelineId: z.uuid().optional() })
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

          const [stagesResult, leadsResult, members] = activePipeline
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
                context.admin
                  .from('crm_leads')
                  .select(
                    'id,pipeline_id,stage_id,contact_id,title,description,status,lost_reason,position_in_stage,value_cents,currency,owner_user_id,last_activity_at,next_action_at,expected_close_date,source,tags,lock_version,created_at,updated_at',
                  )
                  .eq('workspace_id', context.workspaceId)
                  .eq('pipeline_id', activePipeline.id)
                  .order('position_in_stage')
                  .limit(500),
                workspaceMemberOptions({
                  admin: context.admin,
                  workspaceId: context.workspaceId,
                }),
              ])
            : [
                { data: [], error: null },
                { data: [], error: null },
                await workspaceMemberOptions({
                  admin: context.admin,
                  workspaceId: context.workspaceId,
                }),
              ]
          if (stagesResult.error) throw stagesResult.error
          if (leadsResult.error) throw leadsResult.error
          const leads = leadsResult.data
          const leadIds = leads.map((lead) => lead.id)
          const contactIds = Array.from(
            new Set(leads.map((lead) => lead.contact_id).filter(Boolean)),
          )
          const [contactsResult, scoresResult, risksResult] = await Promise.all(
            [
              contactIds.length
                ? context.admin
                    .from('contacts')
                    .select(
                      'id,display_name,full_name,username,phone,email,avatar_url,platform,lead_score',
                    )
                    .eq('workspace_id', context.workspaceId)
                    .in('id', contactIds)
                : Promise.resolve({ data: [], error: null }),
              leadIds.length
                ? context.admin
                    .from('crm_lead_scores')
                    .select('lead_id,probability,reason,band,calculated_at')
                    .eq('workspace_id', context.workspaceId)
                    .in('lead_id', leadIds)
                : Promise.resolve({ data: [], error: null }),
              leadIds.length
                ? context.admin
                    .from('crm_lead_risk_states')
                    .select('lead_id,bucket,since,cold_hours')
                    .eq('workspace_id', context.workspaceId)
                    .in('lead_id', leadIds)
                : Promise.resolve({ data: [], error: null }),
            ],
          )
          for (const result of [contactsResult, scoresResult, risksResult])
            if (result.error) throw result.error
          const contacts = new Map(
            (contactsResult.data ?? []).map((contact) => [contact.id, contact]),
          )
          const scores = new Map(
            (scoresResult.data ?? []).map((score) => [score.lead_id, score]),
          )
          const risks = new Map(
            (risksResult.data ?? []).map((risk) => [risk.lead_id, risk]),
          )
          const memberNames = new Map(
            members.map((member) => [member.id, member.name]),
          )
          const normalizedLeads = leads.map((lead) => ({
            id: lead.id,
            pipelineId: lead.pipeline_id,
            stageId: lead.stage_id,
            contactId: lead.contact_id,
            title: lead.title,
            description: lead.description,
            status: lead.status,
            lostReason: lead.lost_reason,
            position: Number(lead.position_in_stage),
            valueCents:
              lead.value_cents === null ? null : Number(lead.value_cents),
            currency: lead.currency,
            ownerUserId: lead.owner_user_id,
            ownerName: lead.owner_user_id
              ? (memberNames.get(lead.owner_user_id) ?? 'Membro')
              : null,
            lastActivityAt: lead.last_activity_at,
            nextActionAt: lead.next_action_at,
            expectedCloseDate: lead.expected_close_date,
            source: lead.source,
            tags: lead.tags,
            lockVersion: lead.lock_version,
            createdAt: lead.created_at,
            updatedAt: lead.updated_at,
            contact: lead.contact_id
              ? (contacts.get(lead.contact_id) ?? null)
              : null,
            score: scores.get(lead.id) ?? null,
            risk: risks.get(lead.id) ?? null,
          }))

          return Response.json(
            {
              pipelines,
              activePipelineId: activePipeline?.id ?? null,
              stages: stagesResult.data,
              leads: normalizedLeads,
              members,
              permissions: {
                canWrite: context.role !== 'viewer',
                canManagePipelines:
                  context.role === 'owner' || context.role === 'admin',
              },
              summary: {
                open: normalizedLeads.filter((lead) => lead.status === 'open')
                  .length,
                won: normalizedLeads.filter((lead) => lead.status === 'won')
                  .length,
                lost: normalizedLeads.filter((lead) => lead.status === 'lost')
                  .length,
                valueCents: normalizedLeads
                  .filter((lead) => lead.status === 'open')
                  .reduce((total, lead) => total + (lead.valueCents ?? 0), 0),
                atRisk: normalizedLeads.filter((lead) =>
                  ['em_risco', 'critico'].includes(lead.risk?.bucket ?? ''),
                ).length,
              },
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
            const { data: pipeline, error } = await context.admin
              .from('crm_pipelines')
              .insert({
                workspace_id: context.workspaceId,
                name: input.name,
                slug,
                description: input.description || null,
                position: Date.now(),
              })
              .select('id')
              .single()
            if (error?.code === '23505')
              throw new ApiError(409, 'Já existe um pipeline com este nome.')
            if (error) throw error
            const { error: stagesError } = await context.admin
              .from('crm_stages')
              .insert([
                {
                  workspace_id: context.workspaceId,
                  pipeline_id: pipeline.id,
                  name: 'Novo lead',
                  slug: 'novo',
                  position: 1000,
                  color: '#3B82F6',
                  expected_duration_hours: 24,
                },
                {
                  workspace_id: context.workspaceId,
                  pipeline_id: pipeline.id,
                  name: 'Em andamento',
                  slug: 'em-andamento',
                  position: 2000,
                  color: '#F59E0B',
                  expected_duration_hours: 72,
                },
                {
                  workspace_id: context.workspaceId,
                  pipeline_id: pipeline.id,
                  name: 'Ganho',
                  slug: 'ganho',
                  position: 3000,
                  color: '#16A34A',
                  terminal_state: 'won',
                  expected_duration_hours: 720,
                },
                {
                  workspace_id: context.workspaceId,
                  pipeline_id: pipeline.id,
                  name: 'Perdido',
                  slug: 'perdido',
                  position: 4000,
                  color: '#6B7280',
                  terminal_state: 'lost',
                  expected_duration_hours: 720,
                },
              ])
            if (stagesError) throw stagesError
            await writeCrmAudit({
              admin: context.admin,
              workspaceId: context.workspaceId,
              user: context.user,
              action: 'pipeline_created',
              resourceType: 'crm_pipeline',
              resourceId: pipeline.id,
              changes: { name: input.name },
              request,
            })
            return Response.json({ id: pipeline.id }, { status: 201 })
          }

          const { data: stage, error: stageError } = await context.admin
            .from('crm_stages')
            .select('id,pipeline_id,terminal_state')
            .eq('workspace_id', context.workspaceId)
            .eq('id', input.stageId)
            .eq('pipeline_id', input.pipelineId)
            .maybeSingle()
          if (stageError) throw stageError
          if (!stage) throw new ApiError(400, 'Etapa não pertence ao pipeline.')
          if (stage.terminal_state !== 'open')
            throw new ApiError(
              400,
              'Novos leads devem entrar em uma etapa aberta.',
            )
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
              throw new ApiError(400, 'Responsável não pertence ao workspace.')
          }
          const { data: lastLead, error: positionError } = await context.admin
            .from('crm_leads')
            .select('position_in_stage')
            .eq('workspace_id', context.workspaceId)
            .eq('stage_id', input.stageId)
            .order('position_in_stage', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (positionError) throw positionError
          const now = new Date().toISOString()
          const { data: lead, error } = await context.admin
            .from('crm_leads')
            .insert({
              workspace_id: context.workspaceId,
              pipeline_id: input.pipelineId,
              stage_id: input.stageId,
              contact_id: input.contactId ?? null,
              title: input.title,
              description: input.description || null,
              value_cents: input.valueCents ?? null,
              owner_user_id: input.ownerUserId ?? null,
              assigned_at: input.ownerUserId ? now : null,
              expected_close_date: input.expectedCloseDate || null,
              next_action_at: input.nextActionAt || null,
              source: input.source,
              tags: input.tags,
              last_activity_at: now,
              position_in_stage:
                Number(lastLead?.position_in_stage ?? 0) + 1000,
              created_by_user_id: context.user.id,
            })
            .select('id,lock_version')
            .single()
          if (error) throw error
          const { error: activityError } = await context.admin
            .from('crm_lead_activities')
            .insert({
              workspace_id: context.workspaceId,
              lead_id: lead.id,
              contact_id: input.contactId ?? null,
              activity_type: 'lead_created',
              payload: { source: input.source, stageId: input.stageId },
              performed_by_user_id: context.user.id,
            })
          if (activityError) throw activityError
          if (input.contactId) {
            const { data: contact } = await context.admin
              .from('contacts')
              .select('lead_score')
              .eq('workspace_id', context.workspaceId)
              .eq('id', input.contactId)
              .maybeSingle()
            const probability = Number(contact?.lead_score ?? 0)
            if (probability > 0)
              await context.admin.from('crm_lead_scores').upsert({
                lead_id: lead.id,
                workspace_id: context.workspaceId,
                probability,
                reason: 'Score inicial herdado dos sinais do contato.',
                evidence: { contactId: input.contactId },
                band: scoreBand(probability),
                calculated_at: now,
              })
          }
          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action: 'lead_created',
            resourceType: 'crm_lead',
            resourceId: lead.id,
            changes: { pipelineId: input.pipelineId, stageId: input.stageId },
            request,
          })
          return Response.json(lead, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar o item do CRM.')
        }
      },
    },
  },
})
