/** Upload em duas fases: URL assinada curta e registro transacional do anexo. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { readJsonBody } from '../../../server/request-body.server'

const BUCKET = 'crm-assets'
const MAX_FILE_SIZE = 10 * 1024 * 1024
const allowedMimeTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]

const requestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('prepare'),
    leadId: z.uuid(),
    fileName: z.string().trim().min(1).max(180),
    mimeType: z.enum(allowedMimeTypes as [string, ...string[]]),
    sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE),
  }),
  z.object({
    kind: z.literal('register'),
    leadId: z.uuid(),
    storagePath: z.string().min(10).max(700),
    fileName: z.string().trim().min(1).max(180),
    mimeType: z.enum(allowedMimeTypes as [string, ...string[]]),
    sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE),
  }),
])

export const Route = createFileRoute('/api/crm/assets')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const input = requestSchema.parse(await readJsonBody(request))
          const { count, error: leadError } = await context.admin
            .from('crm_leads')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', context.workspaceId)
            .eq('id', input.leadId)
          if (leadError) throw leadError
          if (!count) throw new ApiError(404, 'Lead não encontrado.')

          if (input.kind === 'prepare') {
            await ensurePrivateBucket(context.admin)
            const storagePath = `${context.workspaceId}/${input.leadId}/${crypto.randomUUID()}-${safeFileName(input.fileName)}`
            const { data, error } = await context.admin.storage
              .from(BUCKET)
              .createSignedUploadUrl(storagePath, { upsert: false })
            if (error) throw error
            return Response.json({
              bucket: BUCKET,
              storagePath,
              token: data.token,
            })
          }

          if (
            !input.storagePath.startsWith(
              `${context.workspaceId}/${input.leadId}/`,
            )
          )
            throw new ApiError(400, 'Caminho do anexo inválido.')
          const { data, error } = await context.admin.rpc(
            'crm_register_asset_command',
            {
              target_workspace_id: context.workspaceId,
              actor_user_id: context.user.id,
              target_lead_id: input.leadId,
              target_storage_path: input.storagePath,
              target_file_name: input.fileName,
              target_mime_type: input.mimeType,
              target_size_bytes: input.sizeBytes,
              request_user_agent: request.headers.get('user-agent'),
            },
          )
          if (error?.code === '23514')
            throw new ApiError(400, 'O caminho do anexo não pertence ao lead.')
          if (error) throw error
          return Response.json(data, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao preparar o anexo do CRM.')
        }
      },
    },
  },
})

async function ensurePrivateBucket(
  admin: Awaited<ReturnType<typeof requireWorkspaceContext>>['admin'],
) {
  const current = await admin.storage.getBucket(BUCKET)
  if (current.data) return
  const created = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes,
  })
  if (created.error && !/already exists|duplicate/i.test(created.error.message))
    throw created.error
}

function safeFileName(fileName: string) {
  const extension = fileName.includes('.')
    ? `.${fileName.split('.').at(-1)}`
    : ''
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
  return `${base || 'arquivo'}${extension.toLowerCase().slice(0, 12)}`
}
