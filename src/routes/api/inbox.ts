/** Inbox real: lista conversas/mensagens e atualiza leitura/categoria com tenancy. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'

const querySchema = z.object({
  category: z.enum(['principal', 'geral', 'pedidos', 'ia_off']).optional(),
  conversationId: z.string().uuid().optional(),
})

const updateSchema = z.object({
  conversationId: z.string().uuid(),
  category: z.enum(['principal', 'geral', 'pedidos', 'ia_off']).optional(),
  markRead: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
})

function windowState(lastInboundAt: string | null, optedOutAt: string | null) {
  if (!lastInboundAt || optedOutAt)
    return { open24h: false, humanAgentEligible: false, secondsLeft24h: 0 }
  const elapsed = Date.now() - new Date(lastInboundAt).getTime()
  return {
    open24h: elapsed >= 0 && elapsed <= 24 * 60 * 60_000,
    humanAgentEligible: elapsed >= 0 && elapsed <= 7 * 24 * 60 * 60_000,
    secondsLeft24h: Math.max(
      0,
      Math.floor((24 * 60 * 60_000 - elapsed) / 1_000),
    ),
  }
}

export const Route = createFileRoute('/api/inbox')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const url = new URL(request.url)
          const query = querySchema.parse({
            category: url.searchParams.get('category') ?? undefined,
            conversationId: url.searchParams.get('conversationId') ?? undefined,
          })
          let conversationsQuery = context.supabase
            .from('conversations')
            .select(
              'id,contact_id,instagram_account_id,category,unread_count,last_message_preview,last_message_at,assigned_to',
            )
            .eq('workspace_id', context.workspaceId)
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .limit(100)
          if (query.category)
            conversationsQuery = conversationsQuery.eq(
              'category',
              query.category,
            )
          const { data: conversations, error: conversationsError } =
            await conversationsQuery
          if (conversationsError) throw conversationsError

          const contactIds = Array.from(
            new Set(conversations.map((item) => item.contact_id)),
          )
          const { data: contacts, error: contactsError } = contactIds.length
            ? await context.supabase
                .from('contacts')
                .select(
                  'id,username,full_name,avatar_url,ai_enabled,opted_out_at,last_inbound_at,first_seen_at',
                )
                .eq('workspace_id', context.workspaceId)
                .in('id', contactIds)
            : { data: [], error: null }
          if (contactsError) throw contactsError
          const contactsById = new Map(
            contacts.map((contact) => [contact.id, contact]),
          )
          const resultConversations = conversations.map((conversation) => {
            const contact = contactsById.get(conversation.contact_id)
            const username = contact?.username ?? 'instagram'
            return {
              id: conversation.id,
              contactId: conversation.contact_id,
              instagramAccountId: conversation.instagram_account_id,
              category: conversation.category,
              unread: conversation.unread_count,
              preview: conversation.last_message_preview ?? '',
              lastMessageAt: conversation.last_message_at,
              name: contact?.full_name ?? `@${username}`,
              username,
              avatarUrl: contact?.avatar_url ?? null,
              aiEnabled: contact?.ai_enabled ?? false,
              optedOut: Boolean(contact?.opted_out_at),
              firstSeenAt: contact?.first_seen_at ?? null,
              ...windowState(
                contact?.last_inbound_at ?? null,
                contact?.opted_out_at ?? null,
              ),
            }
          })

          const selectedId =
            query.conversationId ?? resultConversations[0]?.id ?? null
          if (
            selectedId &&
            !resultConversations.some((item) => item.id === selectedId)
          )
            return Response.json(
              { error: 'Conversa não encontrada neste workspace.' },
              { status: 404 },
            )

          const [
            { data: messages, error: messagesError },
            { data: agents, error: agentsError },
          ] = selectedId
            ? await Promise.all([
                context.supabase
                  .from('messages')
                  .select(
                    'id,direction,body,media_url,status,is_ai_generated,is_automated,created_at',
                  )
                  .eq('workspace_id', context.workspaceId)
                  .eq('conversation_id', selectedId)
                  .order('created_at')
                  .limit(200),
                context.supabase
                  .from('ai_agents')
                  .select('id,name,mode')
                  .eq('workspace_id', context.workspaceId)
                  .eq('is_active', true)
                  .order('created_at'),
              ])
            : [
                { data: [], error: null },
                { data: [], error: null },
              ]
          if (messagesError) throw messagesError
          if (agentsError) throw agentsError

          return Response.json(
            {
              conversations: resultConversations,
              selectedId,
              messages,
              agents,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar a Inbox.')
        }
      },
      PATCH: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const body = updateSchema.parse(await request.json())
          const { data: conversation, error: lookupError } =
            await context.supabase
              .from('conversations')
              .select('id,contact_id')
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.conversationId)
              .maybeSingle()
          if (lookupError) throw lookupError
          if (!conversation)
            return Response.json(
              { error: 'Conversa não encontrada.' },
              { status: 404 },
            )

          const conversationChanges: Record<string, unknown> = {}
          if (body.category) conversationChanges.category = body.category
          if (body.markRead) conversationChanges.unread_count = 0
          if (Object.keys(conversationChanges).length > 0) {
            const { error } = await context.supabase
              .from('conversations')
              .update(conversationChanges)
              .eq('workspace_id', context.workspaceId)
              .eq('id', conversation.id)
            if (error) throw error
          }
          if (body.aiEnabled !== undefined) {
            const { error } = await context.supabase
              .from('contacts')
              .update({ ai_enabled: body.aiEnabled })
              .eq('workspace_id', context.workspaceId)
              .eq('id', conversation.contact_id)
            if (error) throw error
          }
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao atualizar a Inbox.')
        }
      },
    },
  },
})
