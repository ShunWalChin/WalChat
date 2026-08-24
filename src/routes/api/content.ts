/** Rascunhos, agendamento e fila de publicação oficial do Instagram. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { contentDraftSchema } from '../../server/content-domain'
import { getServerEnv } from '../../server/env.server'
import { assertRateLimit } from '../../server/rate-limit.server'
import { readJsonBody } from '../../server/request-body.server'

const updateSchema = contentDraftSchema.extend({ id: z.uuid() })
const operationSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(['publish', 'schedule']),
    scheduledAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'schedule' && !value.scheduledAt)
      context.addIssue({
        code: 'custom',
        path: ['scheduledAt'],
        message: 'Informe a data do agendamento.',
      })
  })
const deleteSchema = z.object({ id: z.uuid() }).strict()

export const Route = createFileRoute('/api/content')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [itemsResult, accountsResult] = await Promise.all([
            context.supabase
              .from('content_items')
              .select(
                'id,instagram_account_id,kind,title,caption,script,media,status,scheduled_at,published_at,provider_media_id,publish_error_code,created_at,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('updated_at', { ascending: false })
              .limit(100),
            context.supabase
              .from('instagram_accounts')
              .select('id,username,account_type,status,scopes')
              .eq('workspace_id', context.workspaceId)
              .eq('status', 'connected')
              .order('created_at'),
          ])
          if (itemsResult.error) throw itemsResult.error
          if (accountsResult.error) throw accountsResult.error
          return Response.json({
            items: itemsResult.data.map((item) => ({
              id: item.id,
              accountId: item.instagram_account_id,
              kind: item.kind,
              title: item.title,
              caption: item.caption,
              script: item.script,
              media: item.media,
              status: item.status,
              scheduledAt: item.scheduled_at,
              publishedAt: item.published_at,
              providerMediaId: item.provider_media_id,
              errorCode: item.publish_error_code,
            })),
            accounts: accountsResult.data.map((account) => ({
              id: account.id,
              username: account.username,
              accountType: account.account_type,
              canPublish: (account.scopes ?? []).includes(
                'instagram_business_content_publish',
              ),
            })),
            runtime: {
              demoMode: getServerEnv().DEMO_MODE === 'true',
              canManage: ['owner', 'admin'].includes(context.role),
            },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar o estúdio.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          await assertRateLimit({
            namespace: 'content-save',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 30,
            windowSeconds: 60,
          })
          const body = contentDraftSchema.parse(
            await readJsonBody(request, 256 * 1024),
          )
          await assertPublishAccount(context, body.accountId, body.kind)
          const { data, error } = await context.admin
            .from('content_items')
            .insert({
              workspace_id: context.workspaceId,
              instagram_account_id: body.accountId,
              kind: body.kind,
              title: body.title,
              caption: body.caption ?? null,
              script: body.script ?? null,
              media: body.media,
              status: 'draft',
            })
            .select('id')
            .single()
          if (error) throw error
          return Response.json({ id: data.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao salvar o conteúdo.')
        }
      },
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = updateSchema.parse(
            await readJsonBody(request, 256 * 1024),
          )
          await assertPublishAccount(context, body.accountId, body.kind)
          const { data, error } = await context.admin
            .from('content_items')
            .update({
              instagram_account_id: body.accountId,
              kind: body.kind,
              title: body.title,
              caption: body.caption ?? null,
              script: body.script ?? null,
              media: body.media,
              status: 'draft',
              scheduled_at: null,
              publish_error_code: null,
            })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .in('status', ['idea', 'draft', 'failed'])
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data)
            throw new ApiError(
              409,
              'Conteúdo em publicação não pode ser editado.',
            )
          return Response.json({ id: data.id })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar o conteúdo.')
        }
      },
      PUT: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = operationSchema.parse(await readJsonBody(request))
          if (getServerEnv().DEMO_MODE === 'true')
            throw new ApiError(
              423,
              'O backend está em DEMO_MODE. O rascunho é real, mas agendamento e publicação externa só são liberados pela Central de Go-Live.',
            )
          const { data: item, error } = await context.admin
            .from('content_items')
            .select('id,instagram_account_id,kind,status')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .maybeSingle()
          if (error) throw error
          if (!item || !['draft', 'failed'].includes(item.status))
            throw new ApiError(409, 'Conteúdo não está pronto para a fila.')
          if (!item.instagram_account_id)
            throw new ApiError(422, 'Selecione uma conta Instagram.')
          await assertPublishAccount(
            context,
            item.instagram_account_id,
            item.kind,
          )
          const runAt =
            body.action === 'schedule'
              ? new Date(body.scheduledAt as string)
              : new Date()
          if (runAt.getTime() < Date.now() - 60_000)
            throw new ApiError(422, 'A data de publicação já passou.')
          const dedupe = `content:${item.id}:publish:${runAt.toISOString()}`
          const { data: jobId, error: enqueueError } = await context.admin.rpc(
            'enqueue_content_publish',
            {
              target_workspace_id: context.workspaceId,
              target_content_item_id: item.id,
              target_run_at: runAt.toISOString(),
              target_dedupe_key: dedupe,
            },
          )
          if (enqueueError) throw enqueueError
          return Response.json({
            ok: true,
            jobId,
            scheduledAt: runAt.toISOString(),
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao enfileirar a publicação.')
        }
      },
      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = deleteSchema.parse(await readJsonBody(request))
          const { count, error } = await context.admin
            .from('content_items')
            .delete({ count: 'exact' })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .in('status', ['idea', 'draft', 'failed'])
          if (error) throw error
          if (!count) throw new ApiError(409, 'Conteúdo não pode ser excluído.')
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao excluir o conteúdo.')
        }
      },
    },
  },
})

async function assertPublishAccount(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
  accountId: string,
  kind: 'feed' | 'reel' | 'story' | 'carousel',
) {
  const { data, error } = await context.supabase
    .from('instagram_accounts')
    .select('id,status,scopes,account_type')
    .eq('workspace_id', context.workspaceId)
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.status !== 'connected')
    throw new ApiError(422, 'Conta Instagram não está conectada.')
  if (!(data.scopes ?? []).includes('instagram_business_content_publish'))
    throw new ApiError(422, 'A conta não concedeu permissão de publicação.')
  if (kind === 'story' && data.account_type !== 'BUSINESS')
    throw new ApiError(422, 'Stories pela API exigem conta Business.')
}
