/** CRM multicanal real, derivado apenas dos contatos do workspace autenticado. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../server/api-auth.server'

const querySchema = z.object({
  search: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

function contactEligibility(contact: {
  platform: string
  last_inbound_at: string | null
  opted_out_at: string | null
}) {
  if (contact.opted_out_at)
    return { policy: 'blocked', label: 'Opt-out', tone: 'red' as const }
  if (!contact.last_inbound_at)
    return { policy: 'blocked', label: 'Sem janela', tone: 'gray' as const }
  const elapsed = Date.now() - new Date(contact.last_inbound_at).getTime()
  if (elapsed >= 0 && elapsed <= 24 * 60 * 60_000)
    return {
      policy: 'standard_24h',
      label: '24h aberta',
      tone: 'green' as const,
    }
  if (
    contact.platform === 'instagram' &&
    elapsed >= 0 &&
    elapsed <= 7 * 24 * 60 * 60_000
  )
    return {
      policy: 'human_agent_7d',
      label: 'HUMAN_AGENT',
      tone: 'orange' as const,
    }
  if (contact.platform === 'whatsapp')
    return {
      policy: 'whatsapp_template',
      label: 'Requer template',
      tone: 'blue' as const,
    }
  return { policy: 'blocked', label: 'Bloqueada', tone: 'gray' as const }
}

export const Route = createFileRoute('/api/contacts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const url = new URL(request.url)
          const query = querySchema.parse({
            search: url.searchParams.get('search') ?? '',
            limit: url.searchParams.get('limit') ?? undefined,
          })
          const since7d = new Date(
            Date.now() - 7 * 24 * 60 * 60_000,
          ).toISOString()
          const [contactsResult, totalResult, newResult, tagsCountResult] =
            await Promise.all([
              context.supabase
                .from('contacts')
                .select(
                  'id,platform,username,full_name,phone,whatsapp_user_id,avatar_url,last_interaction_at,last_inbound_at,opted_out_at,first_seen_at',
                )
                .eq('workspace_id', context.workspaceId)
                .order('last_interaction_at', {
                  ascending: false,
                  nullsFirst: false,
                })
                .limit(query.limit),
              context.supabase
                .from('contacts')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', context.workspaceId),
              context.supabase
                .from('contacts')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', context.workspaceId)
                .gte('first_seen_at', since7d),
              context.supabase
                .from('tags')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', context.workspaceId),
            ])
          for (const result of [
            contactsResult,
            totalResult,
            newResult,
            tagsCountResult,
          ])
            if (result.error) throw result.error

          const contactRows = contactsResult.data ?? []
          const contactIds = contactRows.map((contact) => contact.id)
          const { data: links, error: linksError } = contactIds.length
            ? await context.supabase
                .from('contact_tags')
                .select('contact_id,tag_id')
                .eq('workspace_id', context.workspaceId)
                .in('contact_id', contactIds)
            : { data: [], error: null }
          if (linksError) throw linksError
          const tagIds = Array.from(new Set(links.map((link) => link.tag_id)))
          const { data: tags, error: tagsError } = tagIds.length
            ? await context.supabase
                .from('tags')
                .select('id,name,color')
                .eq('workspace_id', context.workspaceId)
                .in('id', tagIds)
            : { data: [], error: null }
          if (tagsError) throw tagsError
          const tagsById = new Map(tags.map((tag) => [tag.id, tag]))
          const tagsByContact = new Map<
            string,
            Array<{ id: string; name: string; color: string }>
          >()
          for (const link of links) {
            const tag = tagsById.get(link.tag_id)
            if (!tag) continue
            tagsByContact.set(link.contact_id, [
              ...(tagsByContact.get(link.contact_id) ?? []),
              tag,
            ])
          }

          const normalizedSearch = query.search.toLocaleLowerCase('pt-BR')
          const contacts = contactRows
            .map((contact) => {
              const platform =
                contact.platform === 'whatsapp'
                  ? ('whatsapp' as const)
                  : ('instagram' as const)
              const identity =
                platform === 'whatsapp'
                  ? (contact.phone ?? contact.whatsapp_user_id ?? 'WhatsApp')
                  : `@${contact.username ?? 'instagram'}`
              return {
                id: contact.id,
                platform,
                name: contact.full_name ?? identity,
                identity,
                avatarUrl: contact.avatar_url,
                lastInteractionAt: contact.last_interaction_at,
                firstSeenAt: contact.first_seen_at,
                tags: tagsByContact.get(contact.id) ?? [],
                eligibility: contactEligibility(contact),
              }
            })
            .filter(
              (contact) =>
                !normalizedSearch ||
                `${contact.name} ${contact.identity}`
                  .toLocaleLowerCase('pt-BR')
                  .includes(normalizedSearch),
            )

          return Response.json(
            {
              contacts,
              summary: {
                total: totalResult.count ?? 0,
                new7d: newResult.count ?? 0,
                tags: tagsCountResult.count ?? 0,
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao consultar os contatos.')
        }
      },
    },
  },
})
