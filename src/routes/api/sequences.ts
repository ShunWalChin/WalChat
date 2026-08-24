/** CRUD transacional e validação operacional das sequências do workspace. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { assertRateLimit } from '../../server/rate-limit.server'
import { readJsonBody } from '../../server/request-body.server'
import {
  sequenceDefinitionSchema,
  sequenceValidationSummary,
} from '../../server/sequence-domain'

const updateSchema = sequenceDefinitionSchema.extend({ id: z.uuid() })
const idSchema = z.object({ id: z.uuid() }).strict()

export const Route = createFileRoute('/api/sequences')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const [
            sequencesResult,
            stepsResult,
            enrollmentsResult,
            triggersResult,
          ] = await Promise.all([
            context.supabase
              .from('sequences')
              .select('id,name,description,is_active,created_at,updated_at')
              .eq('workspace_id', context.workspaceId)
              .order('updated_at', { ascending: false }),
            context.supabase
              .from('sequence_steps')
              .select(
                'id,sequence_id,position,kind,content,media_url,delay_seconds',
              )
              .eq('workspace_id', context.workspaceId)
              .order('position'),
            context.supabase
              .from('sequence_enrollments')
              .select('sequence_id,status')
              .eq('workspace_id', context.workspaceId),
            context.supabase
              .from('triggers')
              .select('sequence_id,is_active')
              .eq('workspace_id', context.workspaceId)
              .not('sequence_id', 'is', null),
          ])
          for (const result of [
            sequencesResult,
            stepsResult,
            enrollmentsResult,
            triggersResult,
          ])
            if (result.error) throw result.error

          const stepsBySequence = new Map<string, typeof stepsResult.data>()
          for (const step of stepsResult.data) {
            const current = stepsBySequence.get(step.sequence_id) ?? []
            current.push(step)
            stepsBySequence.set(step.sequence_id, current)
          }
          return Response.json({
            sequences: sequencesResult.data.map((sequence) => ({
              id: sequence.id,
              name: sequence.name,
              description: sequence.description,
              isActive: sequence.is_active,
              createdAt: sequence.created_at,
              updatedAt: sequence.updated_at,
              contacts: enrollmentsResult.data.filter(
                (item) => item.sequence_id === sequence.id,
              ).length,
              activeContacts: enrollmentsResult.data.filter(
                (item) =>
                  item.sequence_id === sequence.id && item.status === 'active',
              ).length,
              activeTriggers: triggersResult.data.filter(
                (item) =>
                  item.sequence_id === sequence.id && item.is_active === true,
              ).length,
              steps: (stepsBySequence.get(sequence.id) ?? []).map((step) => ({
                id: step.id,
                kind: step.kind,
                content: step.content,
                mediaUrl: step.media_url,
                delaySeconds: step.delay_seconds,
              })),
            })),
            permissions: {
              canManage: ['owner', 'admin'].includes(context.role),
            },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar sequências.')
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
            namespace: 'sequence-save',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 30,
            windowSeconds: 60,
          })
          const body = sequenceDefinitionSchema.parse(
            await readJsonBody(request, 256 * 1024),
          )
          const { data, error } = await context.admin.rpc(
            'save_sequence_definition',
            {
              target_workspace_id: context.workspaceId,
              target_sequence_id: null,
              target_name: body.name,
              target_description: body.description ?? null,
              target_is_active: body.isActive,
              target_steps: body.steps,
            },
          )
          if (error) throw error
          return Response.json(
            { id: data, validation: sequenceValidationSummary(body.steps) },
            { status: 201 },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao criar a sequência.')
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
          const { data, error } = await context.admin.rpc(
            'save_sequence_definition',
            {
              target_workspace_id: context.workspaceId,
              target_sequence_id: body.id,
              target_name: body.name,
              target_description: body.description ?? null,
              target_is_active: body.isActive,
              target_steps: body.steps,
            },
          )
          if (error) throw error
          return Response.json({
            id: data,
            validation: sequenceValidationSummary(body.steps),
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar a sequência.')
        }
      },
      PUT: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request)
          const body = idSchema.parse(await readJsonBody(request))
          const { data: sequence, error } = await context.supabase
            .from('sequences')
            .select(
              'id,is_active,sequence_steps(kind,content,media_url,delay_seconds)',
            )
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
            .maybeSingle()
          if (error) throw error
          if (!sequence) throw new ApiError(404, 'Sequência não encontrada.')
          const steps = sequenceDefinitionSchema.shape.steps.parse(
            sequence.sequence_steps.map((step) => ({
              kind: step.kind,
              content: step.content,
              mediaUrl: step.media_url,
              delaySeconds: step.delay_seconds,
            })),
          )
          return Response.json({
            ok: true,
            active: sequence.is_active,
            validation: sequenceValidationSummary(steps),
          })
        } catch (error) {
          return apiErrorResponse(error, 'A sequência não passou na validação.')
        }
      },
      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
          ])
          const body = idSchema.parse(await readJsonBody(request))
          const [
            { count: triggers, error: triggerError },
            { count: runs, error: runError },
          ] = await Promise.all([
            context.admin
              .from('triggers')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('sequence_id', body.id),
            context.admin
              .from('sequence_enrollments')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', context.workspaceId)
              .eq('sequence_id', body.id)
              .in('status', ['active', 'paused']),
          ])
          if (triggerError) throw triggerError
          if (runError) throw runError
          if (triggers || runs)
            throw new ApiError(
              409,
              'Desvincule gatilhos e encerre contatos ativos antes de excluir.',
            )
          const { count, error } = await context.admin
            .from('sequences')
            .delete({ count: 'exact' })
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.id)
          if (error) throw error
          if (!count) throw new ApiError(404, 'Sequência não encontrada.')
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao excluir a sequência.')
        }
      },
    },
  },
})
