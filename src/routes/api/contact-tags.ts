/** Catálogo de tags do CRM com contagem de uso e arquivamento reversível. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { readJsonBody } from '../../server/request-body.server'
import { nullableText } from '../../server/contacts-crm.server'

const tagName = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N}\s._-]*$/u,
    'Use letras, números, espaço, ponto, hífen ou sublinhado.',
  )
const tagFields = {
  name: tagName,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  description: z.string().trim().max(240).nullable().optional(),
}
const createSchema = z.object(tagFields)
const updateSchema = z.object({
  id: z.uuid(),
  ...tagFields,
  archived: z.boolean().optional(),
})
const archiveSchema = z.object({ id: z.uuid() })

async function assertUniqueName(input: {
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>
  name: string
  exceptId?: string
}) {
  let query = input.context.admin
    .from('tags')
    .select('id,name')
    .eq('workspace_id', input.context.workspaceId)
    .ilike('name', input.name)
    .limit(1)
  if (input.exceptId) query = query.neq('id', input.exceptId)
  const { data, error } = await query
  if (error) throw error
  if (data.length) throw new ApiError(409, 'Já existe uma tag com este nome.')
}

export const Route = createFileRoute('/api/contact-tags')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const includeArchived =
            new URL(request.url).searchParams.get('archived') === 'true'
          let tagsQuery = context.supabase
            .from('tags')
            .select(
              'id,name,color,description,is_automatic,archived_at,created_at',
            )
            .eq('workspace_id', context.workspaceId)
            .order('name')
          if (!includeArchived) tagsQuery = tagsQuery.is('archived_at', null)
          const [{ data: tags, error }, { data: links, error: linksError }] =
            await Promise.all([
              tagsQuery,
              context.supabase
                .from('contact_tags')
                .select('tag_id')
                .eq('workspace_id', context.workspaceId),
            ])
          if (error) throw error
          if (linksError) throw linksError
          const usage = new Map<string, number>()
          for (const link of links)
            usage.set(link.tag_id, (usage.get(link.tag_id) ?? 0) + 1)
          return Response.json(
            {
              tags: tags.map((tag) => ({
                id: tag.id,
                name: tag.name,
                color: tag.color,
                description: tag.description,
                isAutomatic: tag.is_automatic,
                archivedAt: tag.archived_at,
                createdAt: tag.created_at,
                contactCount: usage.get(tag.id) ?? 0,
              })),
              canManage: context.role === 'owner' || context.role === 'admin',
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar as tags.')
        }
      },
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const input = createSchema.parse(await readJsonBody(request))
          await assertUniqueName({ context, name: input.name })
          const { data, error } = await context.admin
            .from('tags')
            .insert({
              workspace_id: context.workspaceId,
              name: input.name,
              color: input.color.toLowerCase(),
              description: nullableText(input.description),
              is_automatic: false,
            })
            .select('id')
            .single()
          if (error) throw error
          return Response.json({ id: data.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar a tag.')
        }
      },
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const input = updateSchema.parse(await readJsonBody(request))
          await assertUniqueName({
            context,
            name: input.name,
            exceptId: input.id,
          })
          const updates: Record<string, unknown> = {
            name: input.name,
            color: input.color.toLowerCase(),
            description: nullableText(input.description),
          }
          if (input.archived !== undefined)
            updates.archived_at = input.archived
              ? new Date().toISOString()
              : null
          const { data, error } = await context.admin
            .from('tags')
            .update(updates)
            .eq('workspace_id', context.workspaceId)
            .eq('id', input.id)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data) throw new ApiError(404, 'Tag não encontrada.')
          return Response.json({ updated: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar a tag.')
        }
      },
      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const input = archiveSchema.parse(await readJsonBody(request))
          const { data, error } = await context.admin
            .from('tags')
            .update({ archived_at: new Date().toISOString() })
            .eq('workspace_id', context.workspaceId)
            .eq('id', input.id)
            .select('id')
            .maybeSingle()
          if (error) throw error
          if (!data) throw new ApiError(404, 'Tag não encontrada.')
          return Response.json({ archived: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao arquivar a tag.')
        }
      },
    },
  },
})
