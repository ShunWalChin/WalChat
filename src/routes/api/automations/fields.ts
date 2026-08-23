/** Catálogo de variáveis tipadas usadas em condições, templates e ações. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import {
  isAutomationFieldValue,
  validateAutomationGraph,
} from '../../../server/automation-graph'
import { assertRateLimit } from '../../../server/rate-limit.server'
import { readJsonBody } from '../../../server/request-body.server'

const fieldKind = z.enum(['custom', 'bot'])
const fieldType = z.enum(['text', 'number', 'date', 'datetime', 'boolean'])
const fieldValue = z.union([
  z.string().max(4_000),
  z.number(),
  z.boolean(),
  z.null(),
])
const createSchema = z
  .object({
    kind: fieldKind,
    fieldKey: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    label: z.string().trim().min(2).max(100),
    fieldType,
    description: z.string().trim().max(500).nullable().optional(),
    value: fieldValue.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'custom' && value.value !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Somente campos globais possuem valor próprio.',
      })
    if (
      value.kind === 'bot' &&
      !isAutomationFieldValue(value.fieldType, value.value ?? null)
    )
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Valor incompatível com o tipo do campo.',
      })
  })
const updateSchema = z
  .object({
    kind: fieldKind,
    id: z.uuid(),
    label: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    value: fieldValue.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.label !== undefined ||
      value.description !== undefined ||
      value.isActive !== undefined ||
      value.value !== undefined,
    { message: 'Nenhuma alteração informada.' },
  )

export const Route = createFileRoute('/api/automations/fields')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [customResult, botResult] = await Promise.all([
            context.supabase
              .from('custom_field_definitions')
              .select(
                'id,field_key,label,field_type,description,is_active,created_at,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('label'),
            context.supabase
              .from('automation_bot_fields')
              .select(
                'id,field_key,label,field_type,value,description,is_active,created_at,updated_at',
              )
              .eq('workspace_id', context.workspaceId)
              .order('label'),
          ])
          if (customResult.error) throw customResult.error
          if (botResult.error) throw botResult.error
          return Response.json({
            customFields: customResult.data,
            botFields: botResult.data,
          })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao consultar os campos da automação.',
          )
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
            namespace: 'automation-field-create',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 30,
            windowSeconds: 60,
          })
          const body = createSchema.parse(await readJsonBody(request))
          const table =
            body.kind === 'custom'
              ? 'custom_field_definitions'
              : 'automation_bot_fields'
          const { data, error } = await context.admin
            .from(table)
            .insert({
              workspace_id: context.workspaceId,
              field_key: body.fieldKey,
              label: body.label,
              field_type: body.fieldType,
              description: body.description ?? null,
              ...(body.kind === 'bot' ? { value: body.value ?? null } : {}),
            })
            .select('*')
            .single()
          if (error?.code === '23505')
            throw new ApiError(409, 'Já existe um campo com essa chave.')
          if (error) throw error
          return Response.json({ field: data }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar o campo da automação.')
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
          const table =
            body.kind === 'custom'
              ? 'custom_field_definitions'
              : 'automation_bot_fields'
          const { data: current, error: currentError } = await context.admin
            .from(table)
            .select('id,field_key,field_type')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .maybeSingle()
          if (currentError) throw currentError
          if (!current) throw new ApiError(404, 'Campo não encontrado.')
          if (body.kind === 'custom' && body.value !== undefined)
            throw new ApiError(422, 'Campo de contato não possui valor global.')
          if (
            body.value !== undefined &&
            !isAutomationFieldValue(current.field_type, body.value)
          )
            throw new ApiError(422, 'Valor incompatível com o tipo do campo.')
          if (
            body.isActive === false &&
            (await fieldUsedByActiveAutomation(
              context,
              body.kind,
              current.field_key,
            ))
          )
            throw new ApiError(
              409,
              'O campo está em uso por uma automação publicada ou em execução.',
            )
          const changes: Record<string, unknown> = {}
          if (body.label !== undefined) changes.label = body.label
          if (body.description !== undefined)
            changes.description = body.description
          if (body.isActive !== undefined) changes.is_active = body.isActive
          if (body.value !== undefined) changes.value = body.value
          const { data, error } = await context.admin
            .from(table)
            .update(changes)
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .select('*')
            .single()
          if (error) throw error
          return Response.json({ field: data })
        } catch (error) {
          return apiErrorResponse(
            error,
            'Falha ao atualizar o campo da automação.',
          )
        }
      },
    },
  },
})

async function fieldUsedByActiveAutomation(
  context: Awaited<ReturnType<typeof requireWorkspaceContext>>,
  kind: z.infer<typeof fieldKind>,
  fieldKey: string,
) {
  const [activeResult, flowsResult] = await Promise.all([
    context.admin
      .from('automation_executions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', context.workspaceId)
      .in('status', ['scheduled', 'running', 'waiting']),
    context.admin
      .from('automation_flows')
      .select('current_version_id')
      .eq('workspace_id', context.workspaceId)
      .eq('status', 'published')
      .not('current_version_id', 'is', null),
  ])
  if (activeResult.error) throw activeResult.error
  if (flowsResult.error) throw flowsResult.error
  // Evita alterar a semântica de uma execução que já carregou sua versão.
  if (activeResult.count) return true
  const versionIds = flowsResult.data
    .map((flow) => flow.current_version_id)
    .filter((id): id is string => Boolean(id))
  if (!versionIds.length) return false
  const { data: versions, error } = await context.admin
    .from('automation_flow_versions')
    .select('graph')
    .eq('workspace_id', context.workspaceId)
    .in('id', versionIds)
  if (error) throw error
  return versions.some((version) => {
    const graph = validateAutomationGraph(version.graph)
    return graph.nodes.some((node) => {
      if (node.type === 'condition')
        return node.config.source === kind && node.config.field === fieldKey
      if (node.type !== 'action') return false
      return node.config.actions.some(
        (action) =>
          ((kind === 'custom' &&
            (action.type === 'set_custom_field' ||
              action.type === 'clear_custom_field')) ||
            (kind === 'bot' && action.type === 'set_bot_field')) &&
          action.fieldKey === fieldKey,
      )
    })
  })
}
