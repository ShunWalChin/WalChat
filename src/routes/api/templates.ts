/** Respostas rápidas pessoais ou compartilhadas do workspace. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { createMessageTemplateSchema } from '../../server/crm-pipeline-contract'
import { writeCrmAudit } from '../../server/crm-pipeline.server'
import { readJsonBody } from '../../server/request-body.server'

export const Route = createFileRoute('/api/templates')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const { data, error } = await context.admin
            .from('message_templates')
            .select(
              'id,owner_user_id,title,body,shortcut,category,use_count,created_at,updated_at',
            )
            .eq('workspace_id', context.workspaceId)
            .or(`owner_user_id.is.null,owner_user_id.eq.${context.user.id}`)
            .order('use_count', { ascending: false })
            .order('updated_at', { ascending: false })
          if (error) throw error
          return Response.json(
            {
              templates: data.map((template) => ({
                ...template,
                shared: template.owner_user_id === null,
                canEdit:
                  template.owner_user_id === context.user.id ||
                  context.role === 'owner' ||
                  context.role === 'admin',
              })),
              permissions: {
                canCreate: context.role !== 'viewer',
                canShare: context.role === 'owner' || context.role === 'admin',
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao consultar respostas rápidas.',
          )
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
          const input = createMessageTemplateSchema.parse(
            await readJsonBody(request),
          )
          if (
            input.shared &&
            context.role !== 'owner' &&
            context.role !== 'admin'
          )
            throw new ApiError(
              403,
              'Apenas gestores criam respostas compartilhadas.',
            )
          const { data, error } = await context.admin
            .from('message_templates')
            .insert({
              workspace_id: context.workspaceId,
              owner_user_id: input.shared ? null : context.user.id,
              title: input.title,
              body: input.body,
              shortcut: input.shortcut || null,
              category: input.category,
              created_by_user_id: context.user.id,
            })
            .select('id')
            .single()
          if (error?.code === '23505')
            throw new ApiError(409, 'Este atalho já está em uso.')
          if (error) throw error
          await writeCrmAudit({
            admin: context.admin,
            workspaceId: context.workspaceId,
            user: context.user,
            action: 'message_template_created',
            resourceType: 'message_template',
            resourceId: data.id,
            changes: {
              title: input.title,
              shortcut: input.shortcut,
              shared: input.shared,
            },
            request,
          })
          return Response.json({ id: data.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar a resposta rápida.')
        }
      },
    },
  },
})
