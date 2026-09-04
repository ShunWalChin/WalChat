/** Exportação CSV dos resultados filtrados do CRM, sem carregar tudo no browser. */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ApiError,
  apiErrorResponse,
  requireWorkspaceContext,
} from '../../../server/api-auth.server'

const querySchema = z.object({
  pipelineId: z.uuid(),
  q: z.string().trim().max(160).default(''),
  owner: z
    .union([z.uuid(), z.literal('unassigned'), z.literal('all')])
    .default('all'),
  risk: z
    .enum(['em_dia', 'em_voo', 'em_risco', 'critico', 'all'])
    .default('all'),
  status: z.enum(['open', 'won', 'lost', 'all']).default('all'),
  tag: z.string().trim().max(40).default('all'),
  sort: z
    .enum(['position', 'next-action', 'value-desc', 'recent'])
    .default('position'),
})

type ExportLead = {
  title: string
  status: string
  ownerName?: string | null
  ownerUserId?: string | null
  valueCents: number | null
  source: string
  tags: string[]
  nextActionAt: string | null
  expectedCloseDate: string | null
  contact?: {
    display_name?: string | null
    full_name?: string | null
    username?: string | null
    email?: string | null
    phone?: string | null
    company?: string | null
  } | null
}

export const Route = createFileRoute('/api/crm/export')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const context = await requireWorkspaceContext(request)
          const url = new URL(request.url)
          const query = querySchema.parse(Object.fromEntries(url.searchParams))
          const { count, error: pipelineError } = await context.admin
            .from('crm_pipelines')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', context.workspaceId)
            .eq('id', query.pipelineId)
            .is('archived_at', null)
          if (pipelineError) throw pipelineError
          if (!count) throw new ApiError(404, 'Pipeline não encontrado.')

          const members =
            await import('../../../server/contacts-crm.server').then(
              ({ workspaceMemberOptions }) =>
                workspaceMemberOptions({
                  admin: context.admin,
                  workspaceId: context.workspaceId,
                }),
            )
          const memberNames = new Map(
            members.map((member) => [member.id, member.name]),
          )
          const rows: ExportLead[] = []
          const pageSize = 200
          for (let page = 1; page <= 50; page += 1) {
            const { data, error } = await context.admin.rpc('crm_list_leads', {
              target_workspace_id: context.workspaceId,
              target_pipeline_id: query.pipelineId,
              target_page: page,
              target_page_size: pageSize,
              target_query: query.q || null,
              target_owner_id:
                query.owner !== 'all' && query.owner !== 'unassigned'
                  ? query.owner
                  : null,
              target_unassigned: query.owner === 'unassigned',
              target_status: query.status === 'all' ? null : query.status,
              target_risk: query.risk === 'all' ? null : query.risk,
              target_tag: query.tag === 'all' ? null : query.tag,
              target_sort: query.sort,
            })
            if (error) throw error
            const payload = data as unknown as {
              items: ExportLead[]
              total: number
            }
            rows.push(
              ...payload.items.map((lead) => ({
                ...lead,
                ownerName: lead.ownerUserId
                  ? (memberNames.get(lead.ownerUserId) ?? 'Membro')
                  : null,
              })),
            )
            if (rows.length >= Number(payload.total)) break
          }
          if (rows.length === 10_000)
            throw new ApiError(
              422,
              'A exportação excede 10 mil leads. Refine os filtros e tente novamente.',
            )

          const header = [
            'Oportunidade',
            'Contato',
            'E-mail',
            'Telefone',
            'Empresa',
            'Situação',
            'Responsável',
            'Valor (centavos)',
            'Origem',
            'Tags',
            'Próxima ação',
            'Fechamento esperado',
          ]
          const csv = [
            header,
            ...rows.map((lead) => [
              lead.title,
              lead.contact?.display_name ??
                lead.contact?.full_name ??
                lead.contact?.username ??
                '',
              lead.contact?.email ?? '',
              lead.contact?.phone ?? '',
              lead.contact?.company ?? '',
              lead.status,
              lead.ownerName ?? '',
              lead.valueCents ?? '',
              lead.source,
              lead.tags.join('|'),
              lead.nextActionAt ?? '',
              lead.expectedCloseDate ?? '',
            ]),
          ]
            .map((row) => row.map(csvCell).join(','))
            .join('\r\n')

          return new Response(`\uFEFF${csv}`, {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="walchat-crm-${new Date().toISOString().slice(0, 10)}.csv"`,
            },
          })
        } catch (error) {
          return apiErrorResponse(error, 'Falha ao exportar os leads.')
        }
      },
    },
  },
})

function csvCell(value: string | number) {
  const text = String(value)
  return `"${text.replaceAll('"', '""')}"`
}
