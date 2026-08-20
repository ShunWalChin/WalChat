/** Perfil 360º do contato e atualização dos campos editáveis do CRM. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import {
  CONTACT_STAGES,
  contactDisplayName,
  eligibilityPresentation,
  normalizePhone,
  nullableText,
  writeContactAudit,
} from '../../../server/contacts-crm.server'

const updateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
    email: z.email().max(254).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    company: z.string().trim().max(120).nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(100).nullable().optional(),
    countryCode: z.string().trim().length(2).nullable().optional(),
    language: z.string().trim().max(12).nullable().optional(),
    timezone: z.string().trim().max(80).nullable().optional(),
    lifecycleStage: z.enum(CONTACT_STAGES).optional(),
    leadScore: z.number().int().min(0).max(100).optional(),
    assignedTo: z.uuid().nullable().optional(),
    customFields: z.record(z.string().max(50), z.string().max(500)).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nenhum campo informado.')

export const Route = createFileRoute('/api/contacts/$contactId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const contactId = z.uuid().parse(params.contactId)
          const { data: contact, error } = await context.supabase
            .from('contacts')
            .select(
              'id,platform,username,full_name,display_name,email,phone,instagram_user_id,whatsapp_user_id,avatar_url,company,job_title,city,state,country_code,language,timezone,lifecycle_stage,lead_score,assigned_to,marketing_consent,consent_updated_at,consent_source,ai_enabled,opted_out_at,last_interaction_at,last_inbound_at,last_outbound_at,first_seen_at,archived_at,custom_fields,created_at,updated_at',
            )
            .eq('workspace_id', context.workspaceId)
            .eq('id', contactId)
            .maybeSingle()
          if (error) throw error
          if (!contact) throw new ApiError(404, 'Contato não encontrado.')

          const [
            eligibilityResult,
            linksResult,
            notesResult,
            auditResult,
            conversationsResult,
            interactionsResult,
          ] = await Promise.all([
            context.supabase
              .from('contact_messaging_eligibility')
              .select('eligibility,seconds_left_24h')
              .eq('workspace_id', context.workspaceId)
              .eq('contact_id', contactId)
              .maybeSingle(),
            context.supabase
              .from('contact_tags')
              .select('tag_id,source,created_at')
              .eq('workspace_id', context.workspaceId)
              .eq('contact_id', contactId),
            context.supabase
              .from('contact_notes')
              .select('id,body,is_pinned,author_user_id,created_at,updated_at')
              .eq('workspace_id', context.workspaceId)
              .eq('contact_id', contactId)
              .order('is_pinned', { ascending: false })
              .order('created_at', { ascending: false })
              .limit(50),
            context.supabase
              .from('contact_audit_log')
              .select('id,action,changes,actor_user_id,created_at')
              .eq('workspace_id', context.workspaceId)
              .eq('contact_id', contactId)
              .order('created_at', { ascending: false })
              .limit(50),
            context.supabase
              .from('conversations')
              .select(
                'id,platform,category,unread_count,last_message_at,ai_enabled',
              )
              .eq('workspace_id', context.workspaceId)
              .eq('contact_id', contactId)
              .order('last_message_at', { ascending: false }),
            context.supabase
              .from('interactions_log')
              .select(
                'id,platform,channel,direction,message_text,status,policy_used,block_reason,created_at',
              )
              .eq('workspace_id', context.workspaceId)
              .eq('contact_id', contactId)
              .order('created_at', { ascending: false })
              .limit(30),
          ])
          for (const result of [
            eligibilityResult,
            linksResult,
            notesResult,
            auditResult,
            conversationsResult,
            interactionsResult,
          ])
            if (result.error) throw result.error

          const links = linksResult.data ?? []
          const tagIds = links.map((link) => link.tag_id)
          const { data: tags, error: tagsError } = tagIds.length
            ? await context.supabase
                .from('tags')
                .select('id,name,color,is_automatic,archived_at')
                .eq('workspace_id', context.workspaceId)
                .in('id', tagIds)
            : { data: [], error: null }
          if (tagsError) throw tagsError
          const linksByTag = new Map(links.map((link) => [link.tag_id, link]))
          const policy = String(
            eligibilityResult.data?.eligibility ?? 'blocked',
          )
          return Response.json(
            {
              contact: {
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
                      ? (contact.phone ??
                        contact.whatsapp_user_id ??
                        'WhatsApp')
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
                createdAt: contact.created_at,
                updatedAt: contact.updated_at,
                eligibility: {
                  policy,
                  secondsLeft24h: Number(
                    eligibilityResult.data?.seconds_left_24h ?? 0,
                  ),
                  ...eligibilityPresentation(policy),
                },
                tags: tags.map((tag) => ({
                  id: tag.id,
                  name: tag.name,
                  color: tag.color,
                  isAutomatic: tag.is_automatic,
                  archivedAt: tag.archived_at,
                  source: linksByTag.get(tag.id)?.source ?? 'manual',
                  addedAt: linksByTag.get(tag.id)?.created_at ?? null,
                })),
              },
              notes: (notesResult.data ?? []).map((note) => ({
                ...note,
                can_edit: note.author_user_id === context.user.id,
                can_delete:
                  note.author_user_id === context.user.id ||
                  context.role === 'owner' ||
                  context.role === 'admin',
              })),
              audit: auditResult.data ?? [],
              conversations: conversationsResult.data ?? [],
              interactions: interactionsResult.data ?? [],
              permissions: {
                canManage: context.role !== 'viewer',
                canRestoreOptIn:
                  context.role === 'owner' || context.role === 'admin',
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar o contato.')
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
          const contactId = z.uuid().parse(params.contactId)
          const input = updateSchema.parse(await request.json())
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
          const updates: Record<string, unknown> = {}
          if (input.displayName !== undefined)
            updates.display_name = nullableText(input.displayName)
          if (input.email !== undefined)
            updates.email =
              nullableText(input.email)?.toLocaleLowerCase('pt-BR') ?? null
          if (input.phone !== undefined)
            updates.phone = normalizePhone(input.phone)
          if (input.company !== undefined)
            updates.company = nullableText(input.company)
          if (input.jobTitle !== undefined)
            updates.job_title = nullableText(input.jobTitle)
          if (input.city !== undefined) updates.city = nullableText(input.city)
          if (input.state !== undefined)
            updates.state = nullableText(input.state)
          if (input.countryCode !== undefined)
            updates.country_code =
              nullableText(input.countryCode)?.toUpperCase() ?? null
          if (input.language !== undefined)
            updates.language = nullableText(input.language)
          if (input.timezone !== undefined)
            updates.timezone = nullableText(input.timezone)
          if (input.lifecycleStage !== undefined)
            updates.lifecycle_stage = input.lifecycleStage
          if (input.leadScore !== undefined)
            updates.lead_score = input.leadScore
          if (input.assignedTo !== undefined)
            updates.assigned_to = input.assignedTo
          if (input.customFields !== undefined)
            updates.custom_fields = input.customFields

          const { data, error } = await context.admin
            .from('contacts')
            .update(updates)
            .eq('workspace_id', context.workspaceId)
            .eq('id', contactId)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data) throw new ApiError(404, 'Contato não encontrado.')
          await writeContactAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            contactIds: [contactId],
            actor: context.user,
            action: 'contact_updated',
            changes: { fields: Object.keys(updates) },
          })
          return Response.json({ updated: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o contato.')
        }
      },
    },
  },
})
