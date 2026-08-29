/** Radar calculado: risco comercial determinístico e próximo passo. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { classifyCrmRisk } from '../../../server/crm-pipeline-contract'

export const Route = createFileRoute('/api/crm/radar')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const { data: leads, error } = await context.admin
            .from('crm_leads')
            .select(
              'id,title,pipeline_id,stage_id,contact_id,owner_user_id,value_cents,last_activity_at,next_action_at,expected_close_date,lock_version,crm_stages!inner(name,color,expected_duration_hours),crm_pipelines!inner(name)',
            )
            .eq('workspace_id', context.workspaceId)
            .eq('status', 'open')
            .order('last_activity_at', { ascending: true, nullsFirst: true })
            .limit(500)
          if (error) throw error
          const contactIds = Array.from(
            new Set(leads.map((lead) => lead.contact_id).filter(Boolean)),
          )
          const { data: contacts, error: contactsError } = contactIds.length
            ? await context.admin
                .from('contacts')
                .select('id,display_name,full_name,username,phone,avatar_url')
                .eq('workspace_id', context.workspaceId)
                .in('id', contactIds)
            : { data: [], error: null }
          if (contactsError) throw contactsError
          const contactsById = new Map(
            contacts.map((contact) => [contact.id, contact]),
          )
          const now = new Date()
          const normalized = leads
            .map((lead) => {
              const stage = Array.isArray(lead.crm_stages)
                ? lead.crm_stages[0]
                : lead.crm_stages
              const pipeline = Array.isArray(lead.crm_pipelines)
                ? lead.crm_pipelines[0]
                : lead.crm_pipelines
              const risk = classifyCrmRisk({
                lastActivityAt: lead.last_activity_at,
                nextActionAt: lead.next_action_at,
                expectedDurationHours: Number(stage.expected_duration_hours),
                now,
              })
              return {
                id: lead.id,
                title: lead.title,
                pipelineId: lead.pipeline_id,
                pipelineName: pipeline.name,
                stageId: lead.stage_id,
                stageName: stage.name,
                stageColor: stage.color,
                contact: lead.contact_id
                  ? (contactsById.get(lead.contact_id) ?? null)
                  : null,
                ownerUserId: lead.owner_user_id,
                valueCents:
                  lead.value_cents === null ? null : Number(lead.value_cents),
                lastActivityAt: lead.last_activity_at,
                nextActionAt: lead.next_action_at,
                expectedCloseDate: lead.expected_close_date,
                lockVersion: lead.lock_version,
                risk,
                needsAction:
                  !lead.next_action_at ||
                  new Date(lead.next_action_at).getTime() <= now.getTime(),
              }
            })
            .sort((left, right) => {
              const weight = { critico: 4, em_risco: 3, em_voo: 2, em_dia: 1 }
              return weight[right.risk.bucket] - weight[left.risk.bucket]
            })
          return Response.json(
            {
              leads: normalized,
              summary: {
                critical: normalized.filter(
                  (lead) => lead.risk.bucket === 'critico',
                ).length,
                atRisk: normalized.filter(
                  (lead) => lead.risk.bucket === 'em_risco',
                ).length,
                inFlight: normalized.filter(
                  (lead) => lead.risk.bucket === 'em_voo',
                ).length,
                onTrack: normalized.filter(
                  (lead) => lead.risk.bucket === 'em_dia',
                ).length,
                needsAction: normalized.filter((lead) => lead.needsAction)
                  .length,
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar o Radar.')
        }
      },
    },
  },
})
