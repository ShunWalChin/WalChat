/** Envio manual autenticado; ainda reaplica compliance e registra auditoria. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { sendInstagramMessage } from '../../../server/meta-sender.server'
import { OutboundDeliveryError } from '../../../server/outbound-delivery.server'

const schema = z.object({
  contactId: z.string().uuid(),
  message: z.string().trim().min(1).max(1_000),
  humanAgent: z.boolean().default(false),
  aiGenerated: z.boolean().default(false),
})

export const Route = createFileRoute('/api/messages/send')({
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
          const body = schema.parse(await request.json())
          const [{ data: contact, error }, { data: blocklist }] =
            await Promise.all([
              context.supabase
                .from('contacts')
                .select(
                  'id,instagram_account_id,instagram_user_id,last_inbound_at,opted_out_at',
                )
                .eq('workspace_id', context.workspaceId)
                .eq('id', body.contactId)
                .maybeSingle(),
              context.supabase
                .from('blocklist_entries')
                .select('term')
                .eq('workspace_id', context.workspaceId)
                .eq('is_active', true),
            ])
          if (error) throw error
          if (!contact || !contact.instagram_account_id)
            return Response.json(
              { error: 'Contato não encontrado.' },
              { status: 404 },
            )
          const result = await sendInstagramMessage({
            workspaceId: context.workspaceId,
            instagramAccountId: contact.instagram_account_id,
            recipientId: contact.instagram_user_id,
            contactId: contact.id,
            idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
            deliverySource: 'manual',
            lastInboundAt: contact.last_inbound_at,
            optedOutAt: contact.opted_out_at,
            isAutomated: false,
            requestedTag: body.humanAgent ? 'HUMAN_AGENT' : null,
            message: body.message,
            blocklist: (blocklist ?? []).map((item) => item.term),
          })
          const now = new Date().toISOString()
          const { data: conversation, error: conversationError } =
            await context.supabase
              .from('conversations')
              .upsert(
                {
                  workspace_id: context.workspaceId,
                  instagram_account_id: contact.instagram_account_id,
                  contact_id: contact.id,
                  last_message_preview: result.decision.body.slice(0, 180),
                  last_message_at: now,
                },
                { onConflict: 'workspace_id,contact_id,instagram_account_id' },
              )
              .select('id')
              .single()
          if (conversationError) throw conversationError
          const deliveryId =
            'deliveryId' in result ? result.deliveryId : undefined
          const interactionPayload = {
            workspace_id: context.workspaceId,
            instagram_account_id: contact.instagram_account_id,
            contact_id: contact.id,
            conversation_id: conversation.id,
            outbound_delivery_id: deliveryId ?? null,
            channel: 'dm',
            direction: 'outbound',
            message_text: result.decision.body,
            status: result.sent ? 'sent' : 'blocked',
            is_automated: false,
            policy_used: result.decision.policy,
            block_reason: result.sent ? null : result.decision.reason,
          }
          const interactionOperation = deliveryId
            ? context.supabase
                .from('interactions_log')
                .upsert(interactionPayload, {
                  onConflict: 'outbound_delivery_id',
                })
            : context.supabase
                .from('interactions_log')
                .insert(interactionPayload)
          const { data: interaction, error: interactionError } =
            await interactionOperation.select('id').single()
          if (interactionError) throw interactionError
          const { error: messageError } = await context.supabase
            .from('messages')
            .upsert(
              {
                workspace_id: context.workspaceId,
                conversation_id: conversation.id,
                contact_id: contact.id,
                interaction_id: interaction.id,
                direction: 'outbound',
                body: result.decision.body,
                status: result.sent ? 'sent' : 'blocked',
                is_ai_generated: body.aiGenerated,
                is_automated: false,
              },
              { onConflict: 'interaction_id' },
            )
          if (messageError) throw messageError
          if (result.sent)
            await context.supabase
              .from('contacts')
              .update({ last_outbound_at: now, last_interaction_at: now })
              .eq('id', contact.id)
          return Response.json(
            {
              sent: result.sent,
              policy: result.decision.policy,
              reason: result.decision.reason,
              replayed: 'replayed' in result ? result.replayed : false,
              ...(result.sent
                ? {}
                : { error: `Envio bloqueado: ${result.decision.reason}` }),
            },
            { status: result.sent ? 200 : 422 },
          )
        } catch (error) {
          if (error instanceof OutboundDeliveryError)
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.httpStatus },
            )
          return apiErrorResponse(error, 'Falha ao enviar a mensagem.')
        }
      },
    },
  },
})
