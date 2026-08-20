/** Gateway manual multicanal; revalida compliance imediatamente antes da Meta. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'
import { normalizeComplianceText } from '../../../server/compliance'
import { sendInstagramMessage } from '../../../server/meta-sender.server'
import { OutboundDeliveryError } from '../../../server/outbound-delivery.server'
import { readJsonBody } from '../../../server/request-body.server'
import { assertRateLimit } from '../../../server/rate-limit.server'
import { sendWhatsAppMessage } from '../../../server/whatsapp-sender.server'

const templateSchema = z.object({
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(35),
  components: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
})

const schema = z
  .object({
    contactId: z.string().uuid(),
    message: z.string().trim().max(4_096).optional(),
    humanAgent: z.boolean().default(false),
    aiGenerated: z.boolean().default(false),
    template: templateSchema.optional(),
  })
  .refine((value) => Boolean(value.message?.trim() || value.template), {
    message: 'Informe uma mensagem ou template.',
  })

function templateHasOptOut(components: unknown) {
  return normalizeComplianceText(JSON.stringify(components)).includes('parar')
}

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
          await assertRateLimit({
            namespace: 'manual-send',
            identity: `${context.workspaceId}:${context.user.id}`,
            limit: 30,
            windowSeconds: 60,
          })
          const body = schema.parse(await readJsonBody(request))
          const [{ data: contact, error }, { data: blocklist }] =
            await Promise.all([
              context.supabase
                .from('contacts')
                .select(
                  'id,platform,instagram_account_id,instagram_user_id,whatsapp_account_id,whatsapp_user_id,last_inbound_at,opted_out_at',
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
          if (!contact)
            return Response.json(
              { error: 'Contato não encontrado.' },
              { status: 404 },
            )
          const idempotencyKey =
            request.headers.get('idempotency-key') ?? undefined
          const blockedTerms = (blocklist ?? []).map((item) => item.term)

          let result
          let accountPayload: Record<string, unknown>
          let messageType = 'text'
          if (contact.platform === 'whatsapp') {
            if (!contact.whatsapp_account_id || !contact.whatsapp_user_id)
              return Response.json(
                { error: 'Contato WhatsApp sem telefone conectado.' },
                { status: 422 },
              )
            if (body.humanAgent)
              return Response.json(
                {
                  error:
                    'HUMAN_AGENT pertence ao Instagram; use template aprovado no WhatsApp fora de 24h.',
                },
                { status: 422 },
              )
            let template:
              | {
                  name: string
                  language: string
                  status: string
                  hasOptOut: boolean
                  components?: Array<Record<string, unknown>>
                }
              | undefined
            if (body.template) {
              const { data: storedTemplate, error: templateError } =
                await context.supabase
                  .from('whatsapp_message_templates')
                  .select('name,language,status,components')
                  .eq('workspace_id', context.workspaceId)
                  .eq('whatsapp_account_id', contact.whatsapp_account_id)
                  .eq('name', body.template.name)
                  .eq('language', body.template.language)
                  .maybeSingle()
              if (templateError) throw templateError
              if (!storedTemplate)
                return Response.json(
                  { error: 'Template não encontrado no cache da WABA.' },
                  { status: 422 },
                )
              template = {
                name: storedTemplate.name,
                language: storedTemplate.language,
                status: storedTemplate.status,
                hasOptOut: templateHasOptOut(storedTemplate.components),
                components: body.template.components,
              }
              messageType = 'template'
            }
            result = await sendWhatsAppMessage({
              workspaceId: context.workspaceId,
              whatsappAccountId: contact.whatsapp_account_id,
              recipientId: contact.whatsapp_user_id,
              contactId: contact.id,
              idempotencyKey,
              deliverySource: 'manual',
              lastInboundAt: contact.last_inbound_at,
              optedOutAt: contact.opted_out_at,
              isAutomated: false,
              message: body.message ?? body.template?.name ?? '',
              template,
              blocklist: blockedTerms,
            })
            accountPayload = {
              platform: 'whatsapp',
              instagram_account_id: null,
              whatsapp_account_id: contact.whatsapp_account_id,
            }
          } else {
            if (!contact.instagram_account_id || !contact.instagram_user_id)
              return Response.json(
                { error: 'Contato Instagram sem conta conectada.' },
                { status: 422 },
              )
            if (body.template)
              return Response.json(
                { error: 'Templates pertencem somente ao WhatsApp.' },
                { status: 422 },
              )
            result = await sendInstagramMessage({
              workspaceId: context.workspaceId,
              instagramAccountId: contact.instagram_account_id,
              recipientId: contact.instagram_user_id,
              contactId: contact.id,
              idempotencyKey,
              deliverySource: 'manual',
              lastInboundAt: contact.last_inbound_at,
              optedOutAt: contact.opted_out_at,
              isAutomated: false,
              requestedTag: body.humanAgent ? 'HUMAN_AGENT' : null,
              message: body.message ?? '',
              blocklist: blockedTerms,
            })
            accountPayload = {
              platform: 'instagram',
              instagram_account_id: contact.instagram_account_id,
              whatsapp_account_id: null,
            }
          }

          const now = new Date().toISOString()
          const { data: conversation, error: conversationError } =
            await context.admin
              .from('conversations')
              .upsert(
                {
                  workspace_id: context.workspaceId,
                  contact_id: contact.id,
                  ...accountPayload,
                  last_message_preview: result.decision.body.slice(0, 180),
                  last_message_at: now,
                },
                { onConflict: 'workspace_id,contact_id,platform' },
              )
              .select('id')
              .single()
          if (conversationError) throw conversationError
          const deliveryId =
            'deliveryId' in result ? result.deliveryId : undefined
          const providerMessageId =
            'result' in result &&
            result.result &&
            typeof result.result === 'object'
              ? extractProviderMessageId(result.result)
              : undefined
          const interactionPayload = {
            workspace_id: context.workspaceId,
            contact_id: contact.id,
            conversation_id: conversation.id,
            outbound_delivery_id: deliveryId ?? null,
            ...accountPayload,
            channel: 'dm',
            direction: 'outbound',
            message_text: result.decision.body,
            status: result.sent ? 'sent' : 'blocked',
            is_automated: false,
            policy_used: result.decision.policy,
            block_reason: result.sent ? null : result.decision.reason,
          }
          const interactionOperation = deliveryId
            ? context.admin
                .from('interactions_log')
                .upsert(interactionPayload, {
                  onConflict: 'outbound_delivery_id',
                })
            : context.admin.from('interactions_log').insert(interactionPayload)
          const { data: interaction, error: interactionError } =
            await interactionOperation.select('id').single()
          if (interactionError) throw interactionError
          const { error: messageError } = await context.admin
            .from('messages')
            .upsert(
              {
                workspace_id: context.workspaceId,
                platform: contact.platform,
                conversation_id: conversation.id,
                contact_id: contact.id,
                interaction_id: interaction.id,
                provider_message_id: providerMessageId ?? null,
                direction: 'outbound',
                body: result.decision.body,
                message_type: messageType,
                status: result.sent ? 'sent' : 'blocked',
                is_ai_generated: body.aiGenerated,
                is_automated: false,
              },
              { onConflict: 'interaction_id' },
            )
          if (messageError) throw messageError
          if (result.sent)
            await context.admin
              .from('contacts')
              .update({ last_outbound_at: now, last_interaction_at: now })
              .eq('workspace_id', context.workspaceId)
              .eq('id', contact.id)
          return Response.json(
            {
              sent: result.sent,
              policy: result.decision.policy,
              reason: result.decision.reason,
              replayed: 'replayed' in result ? result.replayed : false,
              platform: contact.platform,
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

function extractProviderMessageId(result: Record<string, unknown>) {
  if (typeof result.message_id === 'string') return result.message_id
  if (!Array.isArray(result.messages)) return undefined
  const first = result.messages[0]
  return first && typeof first === 'object' && 'id' in first
    ? String(first.id)
    : undefined
}
