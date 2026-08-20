/** Lista o cache e sincroniza templates aprovados diretamente da WABA. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../../../server/api-auth.server'
import { getWhatsAppAccountAccess } from '../../../../../server/integration-credentials.server'
import { readJsonBody } from '../../../../../server/request-body.server'
import { getWhatsAppMessageTemplates } from '../../../../../server/whatsapp-api.server'

const accountSchema = z.object({ accountId: z.string().uuid() })

export const Route = createFileRoute(
  '/api/integrations/meta/whatsapp/templates',
)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const accountId = accountSchema.shape.accountId.parse(
            new URL(request.url).searchParams.get('accountId'),
          )
          const { data, error } = await context.supabase
            .from('whatsapp_message_templates')
            .select(
              'id,whatsapp_account_id,name,language,category,status,parameter_format,components,rejected_reason,last_synced_at',
            )
            .eq('workspace_id', context.workspaceId)
            .eq('whatsapp_account_id', accountId)
            .order('name')
          if (error) throw error
          return Response.json({ templates: data })
        } catch (error) {
          return apiErrorResponse(error, 'Não foi possível listar templates.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = accountSchema.parse(await readJsonBody(request))
          const account = await getWhatsAppAccountAccess({
            workspaceId: context.workspaceId,
            whatsappAccountId: body.accountId,
          })
          const remote = await getWhatsAppMessageTemplates({
            wabaId: account.wabaId,
            accessToken: account.accessToken,
          })
          const now = new Date().toISOString()
          const rows = remote.data.map((template) => ({
            workspace_id: context.workspaceId,
            whatsapp_account_id: body.accountId,
            meta_template_id: template.id ?? null,
            name: template.name,
            language: template.language,
            category: template.category ?? null,
            status: template.status,
            parameter_format: template.parameter_format ?? null,
            components: template.components ?? [],
            rejected_reason: template.rejected_reason ?? null,
            last_synced_at: now,
          }))
          if (rows.length) {
            const { error } = await context.admin
              .from('whatsapp_message_templates')
              .upsert(rows, {
                onConflict: 'whatsapp_account_id,name,language',
              })
            if (error) throw error
          }
          const { error: staleError } = await context.admin
            .from('whatsapp_message_templates')
            .delete()
            .eq('workspace_id', context.workspaceId)
            .eq('whatsapp_account_id', body.accountId)
            .lt('last_synced_at', now)
          if (staleError) throw staleError
          const { error: syncError } = await context.admin
            .from('whatsapp_accounts')
            .update({ last_sync_at: now })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.accountId)
          if (syncError) throw syncError
          return Response.json({ synced: rows.length })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Não foi possível sincronizar templates.',
          )
        }
      },
    },
  },
})
