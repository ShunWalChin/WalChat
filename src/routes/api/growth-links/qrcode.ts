/**
 * QR code de um link de captação.
 *
 * Gerado no servidor e devolvido como SVG: vetor escala para material impresso
 * sem serrilhar, e não engorda o bundle do navegador com um codificador que só
 * é usado nesta tela.
 *
 * O código não é escrito à mão de propósito. QR tem correção de erro e
 * mascaramento; um encoder com bug sutil produz uma imagem que parece certa e
 * não escaneia — pior que não ter o recurso.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import QRCode from 'qrcode'
import {
  ApiError,
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { buildGrowthUrl } from '../../../server/growth-links'
import { assertRateLimit } from '../../../server/rate-limit.server'

const querySchema = z.object({ ref: z.string().trim().min(1).max(2_083) })

export const Route = createFileRoute('/api/growth-links/qrcode')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          await assertRateLimit({
            namespace: 'growth-qrcode',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 60,
            windowSeconds: 60,
          })
          const { ref } = querySchema.parse(
            Object.fromEntries(new URL(request.url).searchParams),
          )

          // O link precisa existir no workspace: gerar QR para um `ref`
          // arbitrário transformaria o endpoint num gerador aberto.
          const { data: link, error } = await context.supabase
            .from('growth_links')
            .select('ref')
            .eq('workspace_id', context.workspaceId)
            .eq('ref', ref)
            .maybeSingle()
          if (error) throw error
          if (!link) throw new ApiError(404, 'Link não encontrado.')

          const { data: conta, error: contaError } = await context.supabase
            .from('instagram_accounts')
            .select('username')
            .eq('workspace_id', context.workspaceId)
            .eq('status', 'connected')
            .order('last_sync_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle()
          if (contaError) throw contaError
          if (!conta?.username)
            throw new ApiError(409, 'Conecte uma conta do Instagram primeiro.')

          const svg = await QRCode.toString(
            buildGrowthUrl(conta.username, link.ref),
            {
              type: 'svg',
              // Nível alto de correção: material impresso risca, dobra e
              // desbota, e o código precisa sobreviver a isso.
              errorCorrectionLevel: 'H',
              margin: 2,
              width: 512,
            },
          )

          return new Response(svg, {
            headers: {
              'Content-Type': 'image/svg+xml; charset=utf-8',
              'Cache-Control': 'private, max-age=3600',
              'Content-Disposition': `inline; filename="qr-${link.ref}.svg"`,
            },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao gerar o QR code.')
        }
      },
    },
  },
})
