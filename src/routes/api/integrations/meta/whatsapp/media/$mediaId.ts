/** Proxy autenticado de mídia: o token Meta nunca é enviado ao navegador. */
import { createFileRoute } from '@tanstack/react-router'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../../../../server/api-auth.server'
import { getWhatsAppAccountAccess } from '../../../../../../server/integration-credentials.server'
import { getWhatsAppMediaMetadata } from '../../../../../../server/whatsapp-api.server'

const MAX_MEDIA_BYTES = 25 * 1024 * 1024

export const Route = createFileRoute(
  '/api/integrations/meta/whatsapp/media/$mediaId',
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireWorkspaceContext(request)
          if (!/^[A-Za-z0-9_-]{5,200}$/.test(params.mediaId))
            return Response.json({ error: 'Mídia inválida.' }, { status: 400 })
          const internalUrl = `/api/integrations/meta/whatsapp/media/${encodeURIComponent(params.mediaId)}`
          const { data: message, error: messageError } = await context.supabase
            .from('messages')
            .select('contact_id')
            .eq('workspace_id', context.workspaceId)
            .eq('platform', 'whatsapp')
            .eq('media_url', internalUrl)
            .limit(1)
            .maybeSingle()
          if (messageError) throw messageError
          if (!message)
            return Response.json(
              { error: 'Mídia não encontrada.' },
              { status: 404 },
            )
          const { data: contact, error: contactError } = await context.supabase
            .from('contacts')
            .select('whatsapp_account_id')
            .eq('workspace_id', context.workspaceId)
            .eq('id', message.contact_id)
            .maybeSingle()
          if (contactError) throw contactError
          if (!contact?.whatsapp_account_id)
            return Response.json(
              { error: 'Conta da mídia não encontrada.' },
              { status: 404 },
            )
          const account = await getWhatsAppAccountAccess({
            workspaceId: context.workspaceId,
            whatsappAccountId: contact.whatsapp_account_id,
          })
          const metadata = await getWhatsAppMediaMetadata({
            mediaId: params.mediaId,
            accessToken: account.accessToken,
          })
          const mediaUrl = new URL(metadata.url)
          const trustedHost =
            mediaUrl.protocol === 'https:' &&
            (mediaUrl.hostname === 'lookaside.fbsbx.com' ||
              mediaUrl.hostname.endsWith('.fbcdn.net') ||
              mediaUrl.hostname.endsWith('.facebook.com'))
          if (!trustedHost)
            return Response.json(
              { error: 'Origem de mídia não autorizada.' },
              { status: 502 },
            )
          if (metadata.file_size && metadata.file_size > MAX_MEDIA_BYTES)
            return Response.json(
              { error: 'Mídia excede o limite de 25 MB.' },
              { status: 413 },
            )
          const response = await fetch(mediaUrl, {
            headers: { Authorization: `Bearer ${account.accessToken}` },
            signal: AbortSignal.timeout(15_000),
          })
          if (!response.ok || !response.body)
            return Response.json(
              { error: 'A Meta não entregou a mídia.' },
              { status: 502 },
            )
          const declaredSize = Number(response.headers.get('content-length'))
          if (Number.isFinite(declaredSize) && declaredSize > MAX_MEDIA_BYTES)
            return Response.json(
              { error: 'Mídia excede o limite de 25 MB.' },
              { status: 413 },
            )
          return new Response(response.body, {
            headers: {
              'Content-Type':
                metadata.mime_type ??
                response.headers.get('content-type') ??
                'application/octet-stream',
              'Cache-Control': 'private, max-age=300',
              'X-Content-Type-Options': 'nosniff',
            },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Não foi possível carregar a mídia.')
        }
      },
    },
  },
})
