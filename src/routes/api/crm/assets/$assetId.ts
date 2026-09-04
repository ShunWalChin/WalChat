/** Gera uma URL curta para baixar um anexo privado do workspace. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ApiError,
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../../server/api-auth.server'

export const Route = createFileRoute('/api/crm/assets/$assetId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const { data: asset, error } = await context.admin
            .from('crm_lead_assets')
            .select('id,storage_bucket,storage_path,file_name')
            .eq('workspace_id', context.workspaceId)
            .eq('id', params.assetId)
            .is('deleted_at', null)
            .maybeSingle()
          if (error) throw error
          if (!asset) throw new ApiError(404, 'Anexo não encontrado.')
          const signed = await context.admin.storage
            .from(asset.storage_bucket)
            .createSignedUrl(asset.storage_path, 60, {
              download: asset.file_name,
            })
          if (signed.error) throw signed.error
          return Response.json(
            { url: signed.data.signedUrl },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao abrir o anexo.')
        }
      },
    },
  },
})
