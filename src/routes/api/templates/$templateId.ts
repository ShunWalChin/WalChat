/** Edição e remoção de uma resposta rápida autorizada. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { createMessageTemplateSchema } from '../../../server/crm-pipeline-contract'
import { writeCrmAudit } from '../../../server/crm-pipeline.server'
import { readJsonBody } from '../../../server/request-body.server'

export const Route = createFileRoute('/api/templates/$templateId')({
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
          const { data: template, error } = await context.admin
            .from('message_templates')
            .select('id,owner_user_id,title,body,use_count')
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.templateId)
            .or(`owner_user_id.is.null,owner_user_id.eq.${context.user.id}`)
            .maybeSingle()
          if (error) throw error
          if (!template) throw new ApiError(404, 'Resposta não encontrada.')
          const { error: updateError } = await context.admin
            .from('message_templates')
            .update({ use_count: template.use_count + 1 })
            .eq('workspace_id', context.workspaceId)
            .eq('id', template.id)
          if (updateError) throw updateError
          return Response.json({
            id: template.id,
            title: template.title,
            body: template.body,
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao usar a resposta rápida.')
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
          const input = createMessageTemplateSchema.parse(
            await readJsonBody(request),
          )
          const { data: current, error: currentError } = await context.admin
            .from('message_templates')
            .select('id,owner_user_id')
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.templateId)
            .maybeSingle()
          if (currentError) throw currentError
          if (!current) throw new ApiError(404, 'Resposta não encontrada.')
          const canManageShared =
            context.role === 'owner' || context.role === 'admin'
          if (current.owner_user_id !== context.user.id && !canManageShared)
            throw new ApiError(403, 'Você não pode editar esta resposta.')
          if (input.shared && !canManageShared)
            throw new ApiError(403, 'Apenas gestores compartilham respostas.')
          const { error } = await context.admin
            .from('message_templates')
            .update({
              owner_user_id: input.shared ? null : context.user.id,
              title: input.title,
              body: input.body,
              shortcut: input.shortcut || null,
              category: input.category,
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.templateId)
          if (error?.code === '23505')
            throw new ApiError(409, 'Este atalho já está em uso.')
          if (error) throw error
          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action: 'message_template_updated',
            resourceType: 'message_template',
            resourceId: params.templateId,
            changes: { title: input.title, shared: input.shared },
            request,
          })
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar a resposta.')
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
          const { data: current, error: currentError } = await context.admin
            .from('message_templates')
            .select('id,owner_user_id,title')
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.templateId)
            .maybeSingle()
          if (currentError) throw currentError
          if (!current) throw new ApiError(404, 'Resposta não encontrada.')
          if (
            current.owner_user_id !== context.user.id &&
            context.role !== 'owner' &&
            context.role !== 'admin'
          )
            throw new ApiError(403, 'Você não pode remover esta resposta.')
          const { error } = await context.admin
            .from('message_templates')
            .delete()
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.templateId)
          if (error) throw error
          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action: 'message_template_deleted',
            resourceType: 'message_template',
            resourceId: params.templateId,
            changes: { title: current.title },
            request,
          })
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao remover a resposta.')
        }
      },
    },
  },
})
