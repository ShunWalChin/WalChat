/** Inbox real: lista conversas/mensagens e atualiza leitura/categoria com tenancy. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  assertTrustedOrigin,
  requireWorkspaceContext,
} from '../../server/api-auth.server'
import { readJsonBody } from '../../server/request-body.server'

const querySchema = z.object({
  category: z.enum(['principal', 'geral', 'pedidos', 'ia_off']).optional(),
  conversationId: z.string().uuid().optional(),
})

const updateSchema = z.object({
  conversationId: z.string().uuid(),
  category: z.enum(['principal', 'geral', 'pedidos', 'ia_off']).optional(),
  markRead: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
  status: z.enum(['open', 'pending', 'resolved']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
})
const noteSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(2_000),
})
const deleteNoteSchema = z.object({ noteId: z.string().uuid() })

function windowState(
  lastInboundAt: string | null,
  optedOutAt: string | null,
  platform: 'instagram' | 'whatsapp',
) {
  if (!lastInboundAt || optedOutAt)
    return { open24h: false, humanAgentEligible: false, secondsLeft24h: 0 }
  const elapsed = Date.now() - new Date(lastInboundAt).getTime()
  return {
    open24h: elapsed >= 0 && elapsed <= 24 * 60 * 60_000,
    humanAgentEligible:
      platform === 'instagram' &&
      elapsed >= 0 &&
      elapsed <= 7 * 24 * 60 * 60_000,
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
              'id,contact_id,platform,instagram_account_id,whatsapp_account_id,category,status,priority,unread_count,last_message_preview,last_message_at,assigned_to',
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
                  'id,platform,username,full_name,phone,whatsapp_user_id,avatar_url,ai_enabled,opted_out_at,last_inbound_at,first_seen_at',
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
            const platform =
              conversation.platform === 'whatsapp'
                ? ('whatsapp' as const)
                : ('instagram' as const)
            const username =
              platform === 'whatsapp'
                ? (contact?.phone ?? contact?.whatsapp_user_id ?? 'whatsapp')
                : (contact?.username ?? 'instagram')
            return {
              id: conversation.id,
              contactId: conversation.contact_id,
              instagramAccountId: conversation.instagram_account_id,
              whatsappAccountId: conversation.whatsapp_account_id,
              platform,
              category: conversation.category,
              status: conversation.status,
              priority: conversation.priority,
              assignedTo: conversation.assigned_to,
              unread: conversation.unread_count,
              preview: conversation.last_message_preview ?? '',
              lastMessageAt: conversation.last_message_at,
              name:
                contact?.full_name ??
                (platform === 'instagram' ? `@${username}` : username),
              username,
              avatarUrl: contact?.avatar_url ?? null,
              aiEnabled: contact?.ai_enabled ?? false,
              optedOut: Boolean(contact?.opted_out_at),
              firstSeenAt: contact?.first_seen_at ?? null,
              ...windowState(
                contact?.last_inbound_at ?? null,
                contact?.opted_out_at ?? null,
                platform,
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
            { data: notes, error: notesError },
          ] = selectedId
            ? await Promise.all([
                context.supabase
                  .from('messages')
                  .select(
                    'id,platform,direction,body,media_url,message_type,status,is_ai_generated,is_automated,created_at',
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
                context.supabase
                  .from('conversation_notes')
                  .select('id,author_user_id,body,created_at,updated_at')
                  .eq('workspace_id', context.workspaceId)
                  .eq('conversation_id', selectedId)
                  .order('created_at', { ascending: false })
                  .limit(50),
              ])
            : [
                { data: [], error: null },
                { data: [], error: null },
                { data: [], error: null },
              ]
          if (messagesError) throw messagesError
          if (agentsError) throw agentsError
          if (notesError) throw notesError

          const selectedConversation = resultConversations.find(
            (item) => item.id === selectedId,
          )
          const { data: whatsappTemplates, error: templatesError } =
            selectedConversation?.platform === 'whatsapp' &&
            selectedConversation.whatsappAccountId
              ? await context.supabase
                  .from('whatsapp_message_templates')
                  .select('id,name,language,category,status,components')
                  .eq('workspace_id', context.workspaceId)
                  .eq(
                    'whatsapp_account_id',
                    selectedConversation.whatsappAccountId,
                  )
                  .eq('status', 'APPROVED')
                  .order('name')
              : { data: [], error: null }
          if (templatesError) throw templatesError

          return Response.json(
            {
              conversations: resultConversations,
              selectedId,
              messages,
              agents,
              notes,
              whatsappTemplates,
              currentUser: {
                id: context.user.id,
                email: context.user.email ?? null,
              },
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
          const body = updateSchema.parse(await readJsonBody(request))
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
          if (body.status) {
            conversationChanges.status = body.status
            conversationChanges.resolved_at =
              body.status === 'resolved' ? new Date().toISOString() : null
          }
          if (body.priority) conversationChanges.priority = body.priority
          if (body.assignedTo !== undefined) {
            if (body.assignedTo) {
              const { data: assignee, error: assigneeError } =
                await context.supabase
                  .from('workspace_members')
                  .select('user_id')
                  .eq('workspace_id', context.workspaceId)
                  .eq('user_id', body.assignedTo)
                  .maybeSingle()
              if (assigneeError) throw assigneeError
              if (!assignee)
                return Response.json(
                  { error: 'Responsável não pertence ao workspace.' },
                  { status: 422 },
                )
            }
            conversationChanges.assigned_to = body.assignedTo
            conversationChanges.last_assigned_at = new Date().toISOString()
          }
          if (Object.keys(conversationChanges).length > 0) {
            const { error } = await context.admin
              .from('conversations')
              .update(conversationChanges)
              .eq('workspace_id', context.workspaceId)
              .eq('id', conversation.id)
            if (error) throw error
          }
          if (body.aiEnabled !== undefined) {
            const { error } = await context.admin
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
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const body = noteSchema.parse(await readJsonBody(request))
          const { data: conversation, error: conversationError } =
            await context.supabase
              .from('conversations')
              .select('id')
              .eq('workspace_id', context.workspaceId)
              .eq('id', body.conversationId)
              .maybeSingle()
          if (conversationError) throw conversationError
          if (!conversation)
            return Response.json(
              { error: 'Conversa não encontrada.' },
              { status: 404 },
            )
          const { data, error } = await context.supabase
            .from('conversation_notes')
            .insert({
              workspace_id: context.workspaceId,
              conversation_id: body.conversationId,
              author_user_id: context.user.id,
              body: body.body,
            })
            .select('id')
            .single()
          if (error) throw error
          return Response.json({ id: data.id }, { status: 201 })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao adicionar a nota.')
        }
      },
      DELETE: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const context = await requireWorkspaceContext(request, [
            'owner',
            'admin',
            'agent',
          ])
          const body = deleteNoteSchema.parse(await readJsonBody(request))
          const { data: note, error: noteError } = await context.supabase
            .from('conversation_notes')
            .select('id,author_user_id')
            .eq('workspace_id', context.workspaceId)
            .eq('id', body.noteId)
            .maybeSingle()
          if (noteError) throw noteError
          if (!note)
            return Response.json(
              { error: 'Nota não encontrada.' },
              { status: 404 },
            )
          if (
            context.role === 'agent' &&
            note.author_user_id !== context.user.id
          )
            throw new ApiError(
              403,
              'Agentes só podem excluir as próprias notas.',
            )
          const { error } = await context.supabase
            .from('conversation_notes')
            .delete()
            .eq('workspace_id', context.workspaceId)
            .eq('id', note.id)
          if (error) throw error
          return Response.json({ ok: true })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao excluir a nota.')
        }
      },
    },
  },
})
