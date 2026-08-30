/**
 * Execução das ferramentas de agenda que a IA aciona.
 *
 * O contrato está em `ai-tools.ts`; aqui está o que acontece de verdade. Toda
 * operação passa pelo `booking-service.server`, que é o mesmo caminho da página
 * pública — a IA não tem um atalho próprio para a agenda, e é isso que impede
 * que ela ofereça um horário que a página já vendeu.
 *
 * O contexto (`workspaceId`, `contactId`) nunca vem do modelo. Ele chega da
 * conversa, que é confiável, e é aplicado por cima dos argumentos. Um modelo
 * convencido pelo lead a "cancelar o agendamento de outra pessoa" não tem por
 * onde expressar isso: as ferramentas não têm esse campo.
 */
import '@tanstack/react-start/server-only'
import {
  BookingError,
  cancelBooking,
  createBooking,
  findAvailableSlots,
  loadBookingPageForWorkspace,
  localDateInZone,
  rescheduleBooking,
} from './booking-service.server'
import type { BookingPageRecord } from './booking-service.server'
import {
  bookingGuidance,
  formatSlotLabel,
  parseSlotInstant,
  spreadSlots,
  toolFailure,
  toolSuccess,
} from './ai-tools'
import type { ToolName } from './ai-tools'
import { getSupabaseAdmin } from './supabase-admin.server'

export type AgendaToolContext = {
  workspaceId: string
  /** Contato da conversa. Sem ele, remarcar e cancelar ficam indisponíveis. */
  contactId: string | null
  /** Agenda a usar; quando ausente, o serviço escolhe a ativa mais antiga. */
  bookingPageId?: string | null
}

/** Resultado de uma chamada, já pronto para voltar ao modelo. */
export type AgendaToolOutcome = {
  output: string
  /** Preenchido quando a chamada mudou a agenda, para registrar no histórico. */
  effect: {
    kind: 'booked' | 'rescheduled' | 'cancelled'
    bookingId: string
  } | null
}

function requireAdmin() {
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('Supabase administrativo indisponível.')
  return admin
}

function readString(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Próxima reunião ativa do contato — o alvo implícito de remarcar e cancelar. */
async function proximaReuniao(input: {
  workspaceId: string
  contactId: string
}) {
  const { data, error } = await requireAdmin()
    .from('bookings')
    .select('id,start_at,end_at,timezone,status,meet_url,booking_page_id')
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .in('status', ['pending', 'confirmed'])
    .gte('end_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

async function carregarAgenda(context: AgendaToolContext) {
  return loadBookingPageForWorkspace({
    workspaceId: context.workspaceId,
    pageId: context.bookingPageId ?? null,
  })
}

async function horariosLivres(page: BookingPageRecord, dias: number) {
  const hoje = localDateInZone(new Date().toISOString(), page.timezone)
  const ate = new Date(
    new Date(`${hoje}T12:00:00.000Z`).getTime() + dias * 86_400_000,
  )
    .toISOString()
    .slice(0, 10)
  return findAvailableSlots(page, hoje, ate)
}

/**
 * Roda uma ferramenta e devolve o texto que o modelo vai ler.
 *
 * Erros de agendamento viram `ok: false` com orientação em vez de exceção: o
 * modelo precisa conseguir contornar — oferecer outro horário quando o escolhido
 * foi tomado — e uma exceção derrubaria a resposta inteira, deixando o cliente
 * sem retorno nenhum.
 */
export async function executeAgendaTool(input: {
  name: ToolName
  args: Record<string, unknown>
  context: AgendaToolContext
}): Promise<AgendaToolOutcome> {
  const { name, args, context } = input
  try {
    switch (name) {
      case 'consultar_horarios': {
        const page = await carregarAgenda(context)
        const dias = Math.min(
          30,
          Math.max(1, Number(args.dias) > 0 ? Number(args.dias) : 7),
        )
        const slots = spreadSlots(await horariosLivres(page, dias))
        if (!slots.length)
          return {
            output: toolFailure(
              'sem_horarios',
              `Não há horário livre nos próximos ${dias} dias. Ofereça procurar mais adiante ou peça a preferência da pessoa.`,
            ),
            effect: null,
          }
        return {
          output: toolSuccess({
            duracaoMinutos: page.duration_minutes,
            fuso: page.timezone,
            horarios: slots.map((slot) => ({
              inicio: slot.startAt,
              quando: formatSlotLabel(slot.startAt, page.timezone),
            })),
          }),
          effect: null,
        }
      }

      case 'agendar_reuniao': {
        const inicio = parseSlotInstant(args.inicio)
        const nome = readString(args, 'nome')
        const email = readString(args, 'email')
        if (!nome || !email)
          return {
            output: toolFailure(
              'faltam_dados',
              'Peça o nome e o e-mail antes de tentar de novo.',
            ),
            effect: null,
          }
        if (!inicio)
          return {
            output: toolFailure(
              'horario_sem_fuso',
              'Use o valor exato do campo "inicio" que veio de consultar_horarios. Não escreva o horário por conta própria: sem o fuso, ele é lido três horas fora.',
            ),
            effect: null,
          }
        const page = await carregarAgenda(context)
        const booking = await createBooking({
          page,
          name: nome,
          email,
          notes: readString(args, 'observacao'),
          startAt: inicio,
          source: 'ai_agent',
          contactId: context.contactId,
        })
        return {
          output: toolSuccess({
            quando: formatSlotLabel(booking.startAt, booking.timezone),
            linkMeet: booking.meetUrl,
            conviteEnviado: booking.invited,
            aviso: booking.warning,
            orientacao: bookingGuidance({
              meetUrl: booking.meetUrl,
              invited: booking.invited,
              email,
            }),
          }),
          effect: { kind: 'booked', bookingId: booking.id },
        }
      }

      case 'consultar_meus_agendamentos': {
        if (!context.contactId)
          return {
            output: toolFailure(
              'sem_contato',
              'Não é possível consultar agendamentos nesta conversa. Peça o e-mail e trate como um agendamento novo.',
            ),
            effect: null,
          }
        const reuniao = await proximaReuniao({
          workspaceId: context.workspaceId,
          contactId: context.contactId,
        })
        if (!reuniao)
          return {
            output: toolSuccess({
              agendamentos: [],
              orientacao:
                'Esta pessoa não tem reunião marcada. Ofereça marcar uma.',
            }),
            effect: null,
          }
        return {
          output: toolSuccess({
            agendamentos: [
              {
                quando: formatSlotLabel(reuniao.start_at, reuniao.timezone),
                linkMeet: reuniao.meet_url,
                situacao: reuniao.status,
              },
            ],
          }),
          effect: null,
        }
      }

      case 'remarcar_reuniao': {
        const inicio = parseSlotInstant(args.inicio)
        if (!context.contactId || !inicio)
          return {
            output: toolFailure(
              'faltam_dados',
              'Use o valor exato do campo "inicio" que veio de consultar_horarios; sem o fuso o horário é lido três horas fora.',
            ),
            effect: null,
          }
        const reuniao = await proximaReuniao({
          workspaceId: context.workspaceId,
          contactId: context.contactId,
        })
        if (!reuniao)
          return {
            output: toolFailure(
              'sem_reuniao',
              'Não há reunião ativa para remarcar. Ofereça marcar uma nova.',
            ),
            effect: null,
          }
        const booking = await rescheduleBooking({
          workspaceId: context.workspaceId,
          bookingId: reuniao.id,
          startAt: inicio,
          reason: 'remarcado pela conversa',
        })
        return {
          output: toolSuccess({
            quando: formatSlotLabel(booking.startAt, booking.timezone),
            linkMeet: booking.meetUrl,
            conviteEnviado: booking.invited,
            aviso: booking.warning,
            orientacao: booking.invited
              ? 'Confirme o horário novo e avise que o convite anterior foi cancelado e substituído.'
              : 'Confirme o horário novo. Nenhum convite sai por e-mail; não mencione convite.',
          }),
          effect: { kind: 'rescheduled', bookingId: booking.id },
        }
      }

      case 'cancelar_reuniao': {
        if (!context.contactId)
          return {
            output: toolFailure(
              'sem_contato',
              'Não é possível cancelar por esta conversa. Encaminhe para um atendente.',
            ),
            effect: null,
          }
        const reuniao = await proximaReuniao({
          workspaceId: context.workspaceId,
          contactId: context.contactId,
        })
        if (!reuniao)
          return {
            output: toolFailure(
              'sem_reuniao',
              'Não há reunião ativa para cancelar.',
            ),
            effect: null,
          }
        await cancelBooking({
          workspaceId: context.workspaceId,
          bookingId: reuniao.id,
          reason: readString(args, 'motivo') ?? 'cancelado pela conversa',
        })
        return {
          output: toolSuccess({
            cancelado: true,
            orientacao:
              'Confirme o cancelamento e ofereça remarcar quando fizer sentido.',
          }),
          effect: { kind: 'cancelled', bookingId: reuniao.id },
        }
      }
    }
  } catch (error) {
    if (error instanceof BookingError)
      return {
        output: toolFailure(
          error.code,
          `${error.message} Consulte os horários de novo antes de propor outro.`,
        ),
        effect: null,
      }
    console.error(
      JSON.stringify({
        event: 'agenda_tool_failed',
        tool: name,
        error: error instanceof Error ? error.name : 'unknown_error',
      }),
    )
    return {
      output: toolFailure(
        'falha_interna',
        'A agenda não respondeu agora. Diga que vai confirmar em seguida e siga a conversa.',
      ),
      effect: null,
    }
  }
}
