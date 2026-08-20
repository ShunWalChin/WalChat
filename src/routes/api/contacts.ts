/** Lista paginada e criação segura de contatos manuais no CRM multicanal. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import {
  CONTACT_STAGES,
  contactDisplayName,
  eligibilityPresentation,
  normalizePhone,
  nullableText,
  workspaceMemberOptions,
  writeContactAudit,
} from '../../server/contacts-crm.server'

const querySchema = z.object({
  search: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  platform: z.enum(['instagram', 'whatsapp', 'manual']).optional(),
  eligibility: z
    .enum(['standard_24h', 'human_agent_7d', 'whatsapp_template', 'blocked'])
    .optional(),
  stage: z.enum(CONTACT_STAGES).optional(),
  tagId: z.uuid().optional(),
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  assigned: z.union([z.uuid(), z.literal('unassigned')]).optional(),
  sort: z
    .enum(['recent', 'name', 'score', 'newest', 'oldest'])
    .default('recent'),
})

const createSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    email: z.email().max(254).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    company: z.string().trim().max(120).nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(100).nullable().optional(),
    countryCode: z.string().trim().length(2).nullable().optional(),
    language: z.string().trim().max(12).nullable().optional(),
    timezone: z.string().trim().max(80).nullable().optional(),
    lifecycleStage: z.enum(CONTACT_STAGES).default('lead'),
    leadScore: z.number().int().min(0).max(100).default(0),
    assignedTo: z.uuid().nullable().optional(),
    marketingConsent: z
      .enum(['unknown', 'granted', 'revoked'])
      .default('unknown'),
    consentSource: z.string().trim().max(120).nullable().optional(),
    customFields: z.record(z.string().max(50), z.string().max(500)).default({}),
  })
  .refine((value) => nullableText(value.email) || nullableText(value.phone), {
    message: 'Informe ao menos email ou telefone.',
    path: ['email'],
  })

type ContactRow = {
  id: string
  platform: string
  username: string | null
  full_name: string | null
  display_name: string | null
  email: string | null
  phone: string | null
  whatsapp_user_id: string | null
  avatar_url: string | null
  company: string | null
  job_title: string | null
  city: string | null
  state: string | null
  country_code: string | null
  language: string | null
  timezone: string | null
  lifecycle_stage: string
  lead_score: number
  assigned_to: string | null
  marketing_consent: string
  consent_updated_at: string | null
  consent_source: string | null
  ai_enabled: boolean
  opted_out_at: string | null
  last_interaction_at: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
  first_seen_at: string
  archived_at: string | null
  custom_fields: Record<string, string> | null
  tags: unknown
  eligibility: string | null
  seconds_left_24h: number | null
  total_count: number | string | null
}

export const Route = createFileRoute('/api/contacts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const url = new URL(request.url)
          const query = querySchema.parse({
            search: url.searchParams.get('search') ?? '',
            page: url.searchParams.get('page') ?? undefined,
            pageSize: url.searchParams.get('pageSize') ?? undefined,
            platform: url.searchParams.get('platform') ?? undefined,
            eligibility: url.searchParams.get('eligibility') ?? undefined,
            stage: url.searchParams.get('stage') ?? undefined,
            tagId: url.searchParams.get('tagId') ?? undefined,
            archived: url.searchParams.get('archived') ?? undefined,
            assigned: url.searchParams.get('assigned') ?? undefined,
            sort: url.searchParams.get('sort') ?? undefined,
          })
          const since7d = new Date(
            Date.now() - 7 * 24 * 60 * 60_000,
          ).toISOString()
          const [
            listResult,
            totalResult,
            newResult,
            tagsResult,
            eligibleResult,
            members,
          ] = await Promise.all([
            context.supabase.rpc('list_workspace_contacts_crm', {
              target_workspace_id: context.workspaceId,
              search_term: query.search,
              platform_filter: query.platform ?? null,
              eligibility_filter: query.eligibility ?? null,
              lifecycle_filter: query.stage ?? null,
              tag_filter: query.tagId ?? null,
              archived_filter: query.archived,
              assignment_filter: query.assigned ?? null,
              sort_field: query.sort,
              page_size: query.pageSize,
              page_offset: (query.page - 1) * query.pageSize,
            }),
            context.supabase
              .from('contacts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .is('archived_at', null),
            context.supabase
              .from('contacts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .is('archived_at', null)
              .gte('first_seen_at', since7d),
            context.supabase
              .from('tags')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .is('archived_at', null),
            context.supabase
              .from('contacts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .is('archived_at', null)
              .is('opted_out_at', null)
              .gte(
                'last_inbound_at',
                new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
              ),
            workspaceMemberOptions({
              admin: context.admin,
              workspaceId: context.workspaceId,
            }),
          ])
          for (const result of [
            listResult,
            totalResult,
            newResult,
            tagsResult,
            eligibleResult,
          ])
            if (result.error) throw result.error

          const rows = (listResult.data ?? []) as ContactRow[]
          const contacts = rows.map((contact) => {
            const policy = String(contact.eligibility ?? 'blocked')
            return {
              id: contact.id,
              platform: contact.platform,
              name: contactDisplayName(contact),
              providerName: contact.full_name,
              displayName: contact.display_name,
              username: contact.username,
              email: contact.email,
              phone: contact.phone,
              identity:
                contact.platform === 'instagram'
                  ? `@${contact.username ?? 'instagram'}`
                  : contact.platform === 'whatsapp'
                    ? (contact.phone ?? contact.whatsapp_user_id ?? 'WhatsApp')
                    : (contact.email ?? contact.phone ?? 'Contato manual'),
              avatarUrl: contact.avatar_url,
              company: contact.company,
              jobTitle: contact.job_title,
              city: contact.city,
              state: contact.state,
              countryCode: contact.country_code,
              language: contact.language,
              timezone: contact.timezone,
              lifecycleStage: contact.lifecycle_stage,
              leadScore: contact.lead_score,
              assignedTo: contact.assigned_to,
              marketingConsent: contact.marketing_consent,
              consentUpdatedAt: contact.consent_updated_at,
              consentSource: contact.consent_source,
              aiEnabled: contact.ai_enabled,
              optedOutAt: contact.opted_out_at,
              lastInteractionAt: contact.last_interaction_at,
              lastInboundAt: contact.last_inbound_at,
              lastOutboundAt: contact.last_outbound_at,
              firstSeenAt: contact.first_seen_at,
              archivedAt: contact.archived_at,
              customFields: contact.custom_fields ?? {},
              tags: Array.isArray(contact.tags) ? contact.tags : [],
              eligibility: {
                policy,
                secondsLeft24h: Number(contact.seconds_left_24h ?? 0),
                ...eligibilityPresentation(policy),
              },
            }
          })
          const filteredTotal = Number(rows.at(0)?.total_count ?? 0)

          return Response.json(
            {
              contacts,
              pagination: {
                page: query.page,
                pageSize: query.pageSize,
                total: filteredTotal,
                pages: Math.max(1, Math.ceil(filteredTotal / query.pageSize)),
              },
              summary: {
                total: totalResult.count ?? 0,
                new7d: newResult.count ?? 0,
                tags: tagsResult.count ?? 0,
                eligible24h: eligibleResult.count ?? 0,
              },
              members,
              permissions: {
                canManage: context.role !== 'viewer',
                canRestoreOptIn:
                  context.role === 'owner' || context.role === 'admin',
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar os contatos.')
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
          const input = createSchema.parse(await request.json())
          const email =
            nullableText(input.email)?.toLocaleLowerCase('pt-BR') ?? null
          const phone = normalizePhone(input.phone)
          if (input.assignedTo) {
            const { count, error } = await context.admin
              .from('workspace_members')
              .select('user_id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('user_id', input.assignedTo)
            if (error) throw error
            if (!count)
              throw new ApiError(400, 'Responsável não pertence ao workspace.')
          }
          if (email) {
            const { count, error } = await context.admin
              .from('contacts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('platform', 'manual')
              .ilike('email', email)
            if (error) throw error
            if (count)
              throw new ApiError(
                409,
                'Já existe um contato manual com este email.',
              )
          }
          if (phone) {
            const { count, error } = await context.admin
              .from('contacts')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('platform', 'manual')
              .eq('phone', phone)
            if (error) throw error
            if (count)
              throw new ApiError(
                409,
                'Já existe um contato manual com este telefone.',
              )
          }
          const consentChanged = input.marketingConsent !== 'unknown'
          const { data: contact, error } = await context.admin
            .from('contacts')
            .insert({
              workspace_id: context.workspaceId,
              platform: 'manual',
              instagram_account_id: null,
              instagram_user_id: null,
              whatsapp_account_id: null,
              whatsapp_user_id: null,
              display_name: input.displayName,
              email,
              phone,
              company: nullableText(input.company),
              job_title: nullableText(input.jobTitle),
              city: nullableText(input.city),
              state: nullableText(input.state),
              country_code:
                nullableText(input.countryCode)?.toUpperCase() ?? null,
              language: nullableText(input.language),
              timezone: nullableText(input.timezone),
              lifecycle_stage: input.lifecycleStage,
              lead_score: input.leadScore,
              assigned_to: input.assignedTo ?? null,
              marketing_consent: input.marketingConsent,
              consent_updated_at: consentChanged
                ? new Date().toISOString()
                : null,
              consent_source: consentChanged
                ? (nullableText(input.consentSource) ?? 'cadastro_manual')
                : null,
              custom_fields: input.customFields,
              import_source: 'manual',
              ai_enabled: false,
            })
            .select('id')
            .single()
          if (error) throw error
          await writeContactAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            contactIds: [contact.id],
            actor: context.user,
            action: 'contact_created',
            changes: { source: 'manual' },
          })
          return Response.json({ id: contact.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar o contato.')
        }
      },
    },
  },
})
