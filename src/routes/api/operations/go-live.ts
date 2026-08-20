/** Central de Go-Live: diagnóstico sanitizado e kill switches por workspace. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { getWorkspaceGoLiveStatus } from '../../../server/go-live.server'
import { writeIntegrationAudit } from '../../../server/integration-credentials.server'
import { readJsonBody } from '../../../server/request-body.server'

const updateSchema = z
  .object({
    externalSendsEnabled: z.boolean().optional(),
    commentToDmEnabled: z.boolean().optional(),
    autonomousAiEnabled: z.boolean().optional(),
    confirmation: z.string().optional(),
  })
  .refine(
    (body) =>
      body.externalSendsEnabled !== undefined ||
      body.commentToDmEnabled !== undefined ||
      body.autonomousAiEnabled !== undefined,
    { message: 'Informe ao menos uma configuração.' },
  )

export const Route = createFileRoute('/api/operations/go-live')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          return Response.json(
            await getWorkspaceGoLiveStatus(context.workspaceId),
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao executar o diagnóstico.')
        }
      },
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = updateSchema.parse(await readJsonBody(request))
          const before = await getWorkspaceGoLiveStatus(context.workspaceId)
          if (
            body.externalSendsEnabled === true &&
            body.confirmation !== 'ATIVAR PRODUCAO'
          )
            return Response.json(
              { error: 'Confirme a ativação digitando ATIVAR PRODUCAO.' },
              { status: 400 },
            )
          if (
            body.externalSendsEnabled === true &&
            !before.canEnableExternalSends
          )
            return Response.json(
              {
                error: 'Existem bloqueios críticos antes da ativação.',
                checks: before.checks.filter((item) => item.status === 'fail'),
              },
              { status: 422 },
            )
          const resultingExternalSends =
            body.externalSendsEnabled ?? before.settings.externalSendsEnabled
          if (body.commentToDmEnabled && !resultingExternalSends)
            return Response.json(
              { error: 'Ative disparos externos antes do Comment-to-DM.' },
              { status: 422 },
            )
          const aiReady = before.checks.find(
            (item) => item.id === 'ai_provider',
          )?.status
          if (body.autonomousAiEnabled && aiReady !== 'pass')
            return Response.json(
              { error: 'Configure e valide o provedor de IA primeiro.' },
              { status: 422 },
            )

          const changes = {
            workspace_id: context.workspaceId,
            external_sends_enabled: resultingExternalSends,
            comment_to_dm_enabled: resultingExternalSends
              ? (body.commentToDmEnabled ?? before.settings.commentToDmEnabled)
              : false,
            autonomous_ai_enabled: resultingExternalSends
              ? (body.autonomousAiEnabled ??
                before.settings.autonomousAiEnabled)
              : false,
            activated_at: resultingExternalSends
              ? (before.settings.activatedAt ?? new Date().toISOString())
              : null,
            activated_by: resultingExternalSends ? context.user.id : null,
          }
          const { error } = await context.admin
            .from('workspace_runtime_settings')
            .upsert(changes, { onConflict: 'workspace_id' })
          if (error) throw error
          await writeIntegrationAudit({
            workspaceId: context.workspaceId,
            actorUserId: context.user.id,
            provider: 'meta',
            action: 'runtime_controls_updated',
            status: 'success',
            details: {
              externalSendsEnabled: changes.external_sends_enabled,
              commentToDmEnabled: changes.comment_to_dm_enabled,
              autonomousAiEnabled: changes.autonomous_ai_enabled,
            },
          })
          return Response.json(
            await getWorkspaceGoLiveStatus(context.workspaceId),
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o Go-Live.')
        }
      },
    },
  },
})
