/** Preview, persistência e enfileiramento seguro de reengajamento. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import {
  campaignBody,
  campaignDraftSchema,
  campaignJobRunAt,
  campaignPreviewSummary,
  evaluateCampaignContact,
} from '../../server/campaign-domain'
import { getServerEnv } from '../../server/env.server'
import { assertRateLimit } from '../../server/rate-limit.server'
import { readJsonBody } from '../../server/request-body.server'

const previewSchema = campaignDraftSchema.extend({
  action: z.literal('preview'),
})
const saveSchema = campaignDraftSchema.extend({
  action: z.literal('save'),
  id: z.uuid().optional(),
})
const startSchema = z
  .object({
    action: z.literal('start'),
    id: z.uuid(),
  })
  .strict()
const pauseSchema = z
  .object({
    action: z.enum(['pause', 'cancel']),
    id: z.uuid(),
  })
  .strict()
const mutationSchema = z.discriminatedUnion('action', [
  previewSchema,
  saveSchema,
  startSchema,
  pauseSchema,
])

type WorkspaceContext = Awaited<ReturnType<typeof requireWorkspaceContext>>

async function audience(
  context: WorkspaceContext,
  input: { message: string; tagId?: string | null },
) {
  let contactIds: string[] | null = null
  if (input.tagId) {
    const { data, error } = await context.supabase
      .from('contact_tags')
      .select('contact_id')
      .eq('workspace_id', context.workspaceId)
      .eq('tag_id', input.tagId)
      .limit(5_000)
    if (error) throw error
    contactIds = data.map((item) => item.contact_id)
    if (contactIds.length === 0) return []
  }
  let query = context.supabase
    .from('contacts')
    .select(
      'id,platform,full_name,display_name,username,last_inbound_at,opted_out_at',
    )
    .eq('workspace_id', context.workspaceId)
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .limit(5_000)
  if (contactIds) query = query.in('id', contactIds)
  const [contactsResult, blocklistResult] = await Promise.all([
    query,
    context.supabase
      .from('blocklist_entries')
      .select('term')
      .eq('workspace_id', context.workspaceId)
      .eq('is_active', true),
  ])
  if (contactsResult.error) throw contactsResult.error
  if (blocklistResult.error) throw blocklistResult.error
  const blocklist = blocklistResult.data.map((item) => item.term)
  return contactsResult.data.map((contact) =>
    evaluateCampaignContact(
      {
        id: contact.id,
        platform: contact.platform,
        name:
          contact.display_name ??
          contact.full_name ??
          contact.username ??
          'Contato',
        username: contact.username,
        lastInboundAt: contact.last_inbound_at,
        optedOutAt: contact.opted_out_at,
      },
      input.message,
      blocklist,
    ),
  )
}

export const Route = createFileRoute('/api/campaigns')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [campaignsResult, recipientsResult, tagsResult] =
            await Promise.all([
              context.supabase
                .from('campaigns')
                .select(
                  'id,name,message,status,rate_per_minute,filters,scheduled_at,started_at,completed_at,created_at,updated_at',
                )
                .eq('workspace_id', context.workspaceId)
                .order('updated_at', { ascending: false })
                .limit(100),
              context.supabase
                .from('campaign_recipients')
                .select('campaign_id,status,eligibility')
                .eq('workspace_id', context.workspaceId),
              context.supabase
                .from('tags')
                .select('id,name,color')
                .eq('workspace_id', context.workspaceId)
                .is('archived_at', null)
                .order('name'),
            ])
          for (const result of [campaignsResult, recipientsResult, tagsResult])
            if (result.error) throw result.error
          return Response.json({
            campaigns: campaignsResult.data.map((campaign) => {
              const recipients = recipientsResult.data.filter(
                (item) => item.campaign_id === campaign.id,
              )
              return {
                id: campaign.id,
                name: campaign.name,
                message: campaign.message,
                status: campaign.status,
                ratePerMinute: campaign.rate_per_minute,
                tagId:
                  campaign.filters &&
                  typeof campaign.filters === 'object' &&
                  'tagId' in campaign.filters
                    ? String(campaign.filters.tagId ?? '') || null
                    : null,
                scheduledAt: campaign.scheduled_at,
                startedAt: campaign.started_at,
                completedAt: campaign.completed_at,
                total: recipients.length,
                sent: recipients.filter((item) => item.status === 'sent')
                  .length,
                blocked: recipients.filter((item) => item.status === 'blocked')
                  .length,
              }
            }),
            tags: tagsResult.data,
            runtime: {
              demoMode: getServerEnv().DEMO_MODE === 'true',
              canManage: ['owner', 'admin'].includes(context.role),
            },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar campanhas.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'campaign-mutation',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 20,
            windowSeconds: 60,
          })
          const body = mutationSchema.parse(
            await readJsonBody(request, 256 * 1024),
          )
          if (body.action === 'preview') {
            const items = await audience(context, body)
            return Response.json({
              summary: campaignPreviewSummary(items),
              contacts: items.slice(0, 100),
              body: campaignBody(body.message),
            })
          }
          if (body.action === 'save') {
            const payload = {
              workspace_id: context.workspaceId,
              name: body.name,
              message: campaignBody(body.message),
              rate_per_minute: body.ratePerMinute,
              filters: { tagId: body.tagId ?? null },
              scheduled_at: body.scheduledAt ?? null,
            }
            const operation = body.id
              ? context.admin
                  .from('campaigns')
                  .update(payload)
                  .eq('workspace_id', context.workspaceId)
                  .eq('id', body.id)
                  .eq('status', 'draft')
              : context.admin.from('campaigns').insert(payload)
            const { data, error } = await operation.select('id').maybeSingle()
            if (error) throw error
            if (!data)
              throw new ApiError(409, 'Somente rascunhos podem ser editados.')
            return Response.json(
              { id: data.id },
              { status: body.id ? 200 : 201 },
            )
          }
          if (body.action === 'pause' || body.action === 'cancel') {
            const status = body.action === 'pause' ? 'paused' : 'cancelled'
            const { data, error } = await context.admin
              .from('campaigns')
              .update({
                status,
                ...(status === 'cancelled'
                  ? { cancelled_at: new Date().toISOString() }
                  : {}),
              })
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.id)
              .in('status', ['scheduled', 'running'])
              .select('id')
              .maybeSingle()
            if (error) throw error
            if (!data)
              throw new ApiError(409, 'Campanha não pode ser alterada.')
            await context.admin
              .from('scheduled_jobs')
              .update({ status: 'blocked', last_error: `campaign_${status}` })
              .eq('workspace_id', context.workspaceId)
              .eq('kind', 'campaign_message')
              .eq('status', 'pending')
              .contains('payload', { campaignId: body.id })
            return Response.json({ ok: true, status })
          }

          if (getServerEnv().DEMO_MODE === 'true')
            throw new ApiError(
              423,
              'O backend está em DEMO_MODE. Salve e valide a campanha, mas só inicie após a Central de Go-Live liberar o ambiente.',
            )
          const { data: campaign, error: campaignError } = await context.admin
            .from('campaigns')
            .select('id,message,rate_per_minute,filters,scheduled_at,status')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .maybeSingle()
          if (campaignError) throw campaignError
          if (!campaign || campaign.status !== 'draft')
            throw new ApiError(409, 'Campanha precisa estar em rascunho.')
          const tagId =
            campaign.filters &&
            typeof campaign.filters === 'object' &&
            'tagId' in campaign.filters
              ? String(campaign.filters.tagId ?? '') || null
              : null
          const items = await audience(context, {
            message: campaign.message,
            tagId,
          })
          const eligible = items.filter(
            (item) => item.eligibility === 'standard_24h',
          )
          if (eligible.length === 0)
            throw new ApiError(422, 'Nenhum contato está elegível agora.')
          const startsAt = campaign.scheduled_at
            ? new Date(campaign.scheduled_at)
            : new Date()
          if (startsAt.getTime() < Date.now() - 60_000)
            throw new ApiError(422, 'A data agendada já passou.')
          const recipients = items.map((item) => ({
            workspace_id: context.workspaceId,
            campaign_id: campaign.id,
            contact_id: item.contactId,
            eligibility: item.eligibility,
            status: item.eligibility === 'standard_24h' ? 'queued' : 'blocked',
            reason: item.reason,
          }))
          const { data: savedRecipients, error: recipientError } =
            await context.admin
              .from('campaign_recipients')
              .upsert(recipients, { onConflict: 'campaign_id,contact_id' })
              .select('id,contact_id,status')
          if (recipientError) throw recipientError
          const eligibleRecipients = savedRecipients.filter(
            (item) => item.status === 'queued',
          )
          const jobs = eligibleRecipients.map((recipient, index) => ({
            workspace_id: context.workspaceId,
            kind: 'campaign_message',
            dedupe_key: `campaign:${campaign.id}:recipient:${recipient.id}`,
            payload: {
              campaignId: campaign.id,
              recipientId: recipient.id,
              contactId: recipient.contact_id,
            },
            run_at: campaignJobRunAt(
              index,
              campaign.rate_per_minute,
              startsAt,
            ).toISOString(),
          }))
          const { error: jobsError } = await context.admin
            .from('scheduled_jobs')
            .upsert(jobs, {
              onConflict: 'workspace_id,dedupe_key',
              ignoreDuplicates: true,
            })
          if (jobsError) throw jobsError
          const { error: startError } = await context.admin
            .from('campaigns')
            .update({
              status: startsAt.getTime() > Date.now() ? 'scheduled' : 'running',
              started_at: new Date().toISOString(),
            })
            .eq('id', campaign.id)
            .eq('workspace_id', context.workspaceId)
          if (startError) throw startError
          return Response.json({
            ok: true,
            queued: jobs.length,
            summary: campaignPreviewSummary(items),
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao operar a campanha.')
        }
      },
    },
  },
})
