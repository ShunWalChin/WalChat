/** Ações em lote do CRM, limitadas ao workspace e registradas em auditoria. */
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
  requireWorkspaceContacts,
  writeContactAudit,
} from '../../../server/contacts-crm.server'

const ids = z.array(z.uuid()).min(1).max(100)
const actionSchema = z.discriminatedUnion('action', [
  z.object({ contactIds: ids, action: z.literal('add_tag'), tagId: z.uuid() }),
  z.object({
    contactIds: ids,
    action: z.literal('remove_tag'),
    tagId: z.uuid(),
  }),
  z.object({ contactIds: ids, action: z.literal('archive') }),
  z.object({ contactIds: ids, action: z.literal('unarchive') }),
  z.object({
    contactIds: ids,
    action: z.literal('set_stage'),
    stage: z.enum(CONTACT_STAGES),
  }),
  z.object({
    contactIds: ids,
    action: z.literal('assign'),
    assignedTo: z.uuid().nullable(),
  }),
  z.object({ contactIds: ids, action: z.literal('opt_out') }),
  z.object({
    contactIds: ids,
    action: z.literal('restore_opt_in'),
    confirmed: z.literal(true),
    source: z.string().trim().min(3).max(120),
  }),
  z.object({ contactIds: ids, action: z.literal('ai_on') }),
  z.object({ contactIds: ids, action: z.literal('ai_off') }),
])

export const Route = createFileRoute('/api/contacts/bulk')({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const input = actionSchema.parse(await request.json())
          const contactIds = Array.from(new Set(input.contactIds))
          const contacts = await requireWorkspaceContacts({
            admin: context.admin,
            workspaceId: context.workspaceId,
            contactIds,
          })
          let changes: Record<string, unknown> = {}

          if (input.action === 'add_tag' || input.action === 'remove_tag') {
            const { data: tag, error } = await context.admin
              .from('tags')
              .select('id,archived_at')
              .eq('workspace_id', context.workspaceId)
              .eq('id', input.tagId)
              .maybeSingle()
            if (error) throw error
            if (!tag || tag.archived_at)
              throw new ApiError(404, 'Tag ativa não encontrada.')
            if (input.action === 'add_tag') {
              const { error: linkError } = await context.admin
                .from('contact_tags')
                .upsert(
                  contactIds.map((contactId) => ({
                    workspace_id: context.workspaceId,
                    contact_id: contactId,
                    tag_id: input.tagId,
                    added_by: context.user.id,
                    source: 'manual',
                    metadata: {},
                  })),
                  { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
                )
              if (linkError) throw linkError
            } else {
              const { error: unlinkError } = await context.admin
                .from('contact_tags')
                .delete()
                .eq('workspace_id', context.workspaceId)
                .eq('tag_id', input.tagId)
                .in('contact_id', contactIds)
              if (unlinkError) throw unlinkError
            }
            changes = { tagId: input.tagId }
          } else if (
            input.action === 'archive' ||
            input.action === 'unarchive'
          ) {
            const { error } = await context.admin
              .from('contacts')
              .update({
                archived_at:
                  input.action === 'archive' ? new Date().toISOString() : null,
              })
              .eq('workspace_id', context.workspaceId)
              .in('id', contactIds)
            if (error) throw error
          } else if (input.action === 'set_stage') {
            const { error } = await context.admin
              .from('contacts')
              .update({ lifecycle_stage: input.stage })
              .eq('workspace_id', context.workspaceId)
              .in('id', contactIds)
            if (error) throw error
            changes = { stage: input.stage }
          } else if (input.action === 'assign') {
            if (input.assignedTo) {
              const { count, error } = await context.admin
                .from('workspace_members')
                .select('user_id', { count: 'exact', head: true })
                .eq('workspace_id', context.workspaceId)
                .eq('user_id', input.assignedTo)
              if (error) throw error
              if (!count)
                throw new ApiError(
                  400,
                  'Responsável não pertence ao workspace.',
                )
            }
            const { error } = await context.admin
              .from('contacts')
              .update({ assigned_to: input.assignedTo })
              .eq('workspace_id', context.workspaceId)
              .in('id', contactIds)
            if (error) throw error
            changes = { assignedTo: input.assignedTo }
          } else if (input.action === 'opt_out') {
            const now = new Date().toISOString()
            const { error } = await context.admin
              .from('contacts')
              .update({
                opted_out_at: now,
                ai_enabled: false,
                marketing_consent: 'revoked',
                consent_updated_at: now,
                consent_source: 'crm_manual_opt_out',
              })
              .eq('workspace_id', context.workspaceId)
              .in('id', contactIds)
            if (error) throw error
          } else if (input.action === 'restore_opt_in') {
            if (context.role !== 'owner' && context.role !== 'admin')
              throw new ApiError(
                403,
                'Somente owner ou admin pode registrar um novo opt-in.',
              )
            const now = new Date().toISOString()
            const { error } = await context.admin
              .from('contacts')
              .update({
                opted_out_at: null,
                marketing_consent: 'granted',
                consent_updated_at: now,
                consent_source: input.source,
              })
              .eq('workspace_id', context.workspaceId)
              .in('id', contactIds)
            if (error) throw error
            changes = { source: input.source, confirmed: true }
          } else {
            if (
              input.action === 'ai_on' &&
              contacts.some(
                (contact) =>
                  contact.opted_out_at || contact.platform === 'manual',
              )
            )
              throw new ApiError(
                409,
                'IA não pode ser ligada para opt-out ou contato sem canal Meta.',
              )
            const { error } = await context.admin
              .from('contacts')
              .update({ ai_enabled: input.action === 'ai_on' })
              .eq('workspace_id', context.workspaceId)
              .in('id', contactIds)
            if (error) throw error
          }

          await writeContactAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            contactIds,
            actor: context.user,
            action: input.action,
            changes,
          })
          return Response.json({ updated: contactIds.length })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao aplicar a ação em lote.')
        }
      },
    },
  },
})
