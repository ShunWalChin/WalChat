/** Notas internas do contato, com pin, autoria e trilha de auditoria. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'
import {
  requireWorkspaceContacts,
  writeContactAudit,
} from '../../../../server/contacts-crm.server'

const createSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  isPinned: z.boolean().default(false),
})
const updateSchema = z
  .object({
    noteId: z.uuid(),
    body: z.string().trim().min(1).max(4000).optional(),
    isPinned: z.boolean().optional(),
  })
  .refine(
    (value) => value.body !== undefined || value.isPinned !== undefined,
    'Nenhuma alteração informada.',
  )
const deleteSchema = z.object({ noteId: z.uuid() })

export const Route = createFileRoute('/api/contacts/$contactId/notes')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const contactId = z.uuid().parse(params.contactId)
          const input = createSchema.parse(await request.json())
          await requireWorkspaceContacts({
            admin: context.admin,
            workspaceId: context.workspaceId,
            contactIds: [contactId],
          })
          const { data, error } = await context.supabase
            .from('contact_notes')
            .insert({
              workspace_id: context.workspaceId,
              contact_id: contactId,
              author_user_id: context.user.id,
              body: input.body,
              is_pinned: input.isPinned,
            })
            .select('id')
            .single()
          if (error) throw error
          await writeContactAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            contactIds: [contactId],
            actor: context.user,
            action: 'note_created',
            changes: { noteId: data.id, pinned: input.isPinned },
          })
          return Response.json({ id: data.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar a nota.')
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
          const updates: Record<string, unknown> = {}
          if (input.body !== undefined) updates.body = input.body
          if (input.isPinned !== undefined) updates.is_pinned = input.isPinned
          const { data, error } = await context.supabase
            .from('contact_notes')
            .update(updates)
            .eq('workspace_id', context.workspaceId)
            .eq('contact_id', contactId)
            .eq('id', input.noteId)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data)
            throw new ApiError(
              404,
              'Nota não encontrada ou pertencente a outro autor.',
            )
          await writeContactAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            contactIds: [contactId],
            actor: context.user,
            action: 'note_updated',
            changes: { noteId: input.noteId, fields: Object.keys(updates) },
          })
          return Response.json({ updated: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar a nota.')
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const contactId = z.uuid().parse(params.contactId)
          const input = deleteSchema.parse(await request.json())
          const { data, error } = await context.supabase
            .from('contact_notes')
            .delete()
            .eq('workspace_id', context.workspaceId)
            .eq('contact_id', contactId)
            .eq('id', input.noteId)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data)
            throw new ApiError(
              404,
              'Nota não encontrada ou sem permissão para exclusão.',
            )
          await writeContactAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            contactIds: [contactId],
            actor: context.user,
            action: 'note_deleted',
            changes: { noteId: input.noteId },
          })
          return Response.json({ deleted: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao excluir a nota.')
        }
      },
    },
  },
})
