/**
 * Serviço único de agendamento.
 *
 * Existe por um motivo específico: antes deste módulo, a única forma de reservar
 * um horário era a página pública, e toda a composição — juntar os compromissos
 * locais com o freeBusy do Google, gerar os horários livres, reservar em
 * transação e criar o evento com Meet — vivia dentro daquela rota HTTP.
 *
 * No momento em que um segundo caminho precisa agendar (a IA na conversa, um nó
 * de automação, o operador pela tela), copiar aquela composição é o começo de um
 * agendamento em cima do outro: basta uma das cópias esquecer o freeBusy, ou
 * checar disponibilidade com um intervalo diferente, para duas pessoas caírem no
 * mesmo horário. Então a composição mora aqui, e quem quer agendar chama.
 *
 * A garantia forte não é deste módulo e sim do banco: `reserve_calendar_booking`
 * pega um lock consultivo pela agenda e revalida a sobreposição dentro da
 * transação. A checagem daqui serve para escolher e para responder bem; a do
 * banco é a que decide. Duas requisições simultâneas no mesmo minuto passam pela
 * primeira e só uma passa pela segunda.
 */
import '@tanstack/react-start/server-only'
import { randomUUID } from 'node:crypto'
import { generateAvailableSlots, zonedDateTimeToUtc } from './calendar-domain'
import type {
  AvailableSlot,
  BusyRange,
  WeeklyAvailability,
} from './calendar-domain'
import {
  deleteGoogleEvent,
  queryGoogleFreeBusy,
  upsertGoogleEvent,
} from './google-calendar.server'
import { getSupabaseAdmin } from './supabase-admin.server'

/** Erro de agendamento com código estável, para a IA e a HTTP traduzirem. */
export class BookingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BookingError'
  }
}

export type BookingPageRecord = {
  id: string
  workspace_id: string
  calendar_connection_id: string | null
  calendar_id: string
  slug: string
  title: string
  description: string | null
  duration_minutes: number
  timezone: string
  availability: WeeklyAvailability
  buffer_before_minutes: number
  buffer_after_minutes: number
  minimum_notice_minutes: number
  max_advance_days: number
  create_meet: boolean
  require_phone: boolean
  confirmation_message: string | null
}

const PAGE_COLUMNS =
  'id,workspace_id,calendar_connection_id,calendar_id,slug,title,description,duration_minutes,timezone,availability,buffer_before_minutes,buffer_after_minutes,minimum_notice_minutes,max_advance_days,create_meet,require_phone,confirmation_message'

function requireAdmin() {
  const admin = getSupabaseAdmin()
  if (!admin)
    throw new BookingError(
      503,
      'admin_unavailable',
      'Supabase administrativo indisponível.',
    )
  return admin
}

export async function loadBookingPageBySlug(slug: string) {
  const { data, error } = await requireAdmin()
    .from('booking_pages')
    .select(PAGE_COLUMNS)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!data)
    throw new BookingError(
      404,
      'page_not_found',
      'Agenda não encontrada ou desativada.',
    )
  return data
}

/**
 * Resolve a agenda que um caminho interno deve usar.
 *
 * Sem `pageId`, pega a agenda ativa mais antiga do workspace. A escolha é
 * deliberada: a IA conversando com um lead não tem como saber qual página usar,
 * e a mais antiga é estável — não muda de significado quando alguém cria uma
 * agenda nova para um teste.
 */
export async function loadBookingPageForWorkspace(input: {
  workspaceId: string
  pageId?: string | null
}) {
  let query = requireAdmin()
    .from('booking_pages')
    .select(PAGE_COLUMNS)
    .eq('workspace_id', input.workspaceId)
    .eq('is_active', true)
  query = input.pageId
    ? query.eq('id', input.pageId)
    : query.order('created_at', { ascending: true }).limit(1)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data)
    throw new BookingError(
      404,
      'page_not_found',
      'Nenhuma agenda de reuniões está ativa neste workspace.',
    )
  return data
}

function nextDate(date: string) {
  return new Date(new Date(`${date}T12:00:00.000Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/** Converte um instante para a data local da agenda, no formato AAAA-MM-DD. */
export function localDateInZone(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/**
 * Reúne tudo que ocupa a agenda no intervalo.
 *
 * Falha fechada de propósito: se o Google está ligado e não responde, o certo é
 * não oferecer horário nenhum. Oferecer um horário sem ter conseguido validar a
 * agenda real é como marcar no escuro — a reunião entra por cima de outra coisa
 * e quem descobre é o cliente, na hora.
 */
async function busyForPage(page: BookingPageRecord, from: string, to: string) {
  const admin = requireAdmin()
  const timeMin = zonedDateTimeToUtc(from, '00:00', page.timezone).toISOString()
  const timeMax = zonedDateTimeToUtc(
    nextDate(to),
    '00:00',
    page.timezone,
  ).toISOString()
  const local = await admin
    .from('bookings')
    .select('start_at,end_at')
    .eq('booking_page_id', page.id)
    .in('status', ['pending', 'confirmed'])
    .lt('start_at', timeMax)
    .gt('end_at', timeMin)
  if (local.error) throw local.error
  const busy: BusyRange[] = local.data.map((item) => ({
    start: item.start_at,
    end: item.end_at,
  }))
  if (page.calendar_connection_id) {
    try {
      busy.push(
        ...(await queryGoogleFreeBusy({
          workspaceId: page.workspace_id,
          connectionId: page.calendar_connection_id,
          calendarId: page.calendar_id,
          timeMin,
          timeMax,
          timezone: page.timezone,
        })),
      )
    } catch {
      throw new BookingError(
        503,
        'google_unavailable',
        'Não foi possível validar a agenda Google agora. Tente novamente em instantes.',
      )
    }
  }
  return busy
}

export async function findAvailableSlots(
  page: BookingPageRecord,
  from: string,
  to: string,
): Promise<AvailableSlot[]> {
  const busy = await busyForPage(page, from, to)
  return generateAvailableSlots({
    from,
    to,
    timezone: page.timezone,
    availability: page.availability,
    durationMinutes: page.duration_minutes,
    bufferBeforeMinutes: page.buffer_before_minutes,
    bufferAfterMinutes: page.buffer_after_minutes,
    minimumNoticeMinutes: page.minimum_notice_minutes,
    maxAdvanceDays: page.max_advance_days,
    busy,
  })
}

/**
 * Encontra ou cria o contato do convidado.
 *
 * Quando o agendamento nasce de uma conversa, o contato já existe e vem por
 * `contactId` — reaproveitá-lo mantém a reunião presa à mesma pessoa do Inbox em
 * vez de criar um segundo registro com o mesmo e-mail.
 */
async function resolveContact(input: {
  workspaceId: string
  contactId?: string | null
  name: string
  email: string
  phone?: string | null
}) {
  const admin = requireAdmin()
  if (input.contactId) {
    const existing = await admin
      .from('contacts')
      .select('id,email')
      .eq('workspace_id', input.workspaceId)
      .eq('id', input.contactId)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) {
      // O e-mail dado no agendamento costuma ser o primeiro que temos daquela
      // pessoa; guardá-lo é o que permite o convite e o lembrete chegarem.
      if (!existing.data.email)
        await admin
          .from('contacts')
          .update({ email: input.email.toLowerCase() })
          .eq('id', existing.data.id)
      return existing.data.id
    }
  }
  const found = await admin
    .from('contacts')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .ilike('email', input.email)
    .limit(1)
    .maybeSingle()
  if (found.error) throw found.error
  if (found.data) return found.data.id
  const created = await admin
    .from('contacts')
    .insert({
      workspace_id: input.workspaceId,
      platform: 'manual',
      instagram_account_id: null,
      instagram_user_id: null,
      whatsapp_account_id: null,
      whatsapp_user_id: null,
      display_name: input.name,
      email: input.email.toLowerCase(),
      phone: input.phone ?? null,
      import_source: 'booking_page',
      marketing_consent: 'unknown',
    })
    .select('id')
    .single()
  if (created.error) throw created.error
  return created.data.id
}

export type CreateBookingInput = {
  page: BookingPageRecord
  name: string
  email: string
  phone?: string | null
  notes?: string | null
  startAt: string
  /** De onde veio a reserva; a coluna aceita apenas este conjunto. */
  source: 'public_page' | 'ai_agent' | 'trigger' | 'sequence' | 'manual'
  contactId?: string | null
  idempotencyKey?: string | null
}

export type BookingResult = {
  id: string
  startAt: string
  endAt: string
  timezone: string
  meetUrl: string | null
  status: string
  /** Preenchido quando a reserva vale mas o convite Google não saiu. */
  warning: string | null
  /**
   * Se o convidado realmente recebeu convite por e-mail.
   *
   * Só é verdadeiro quando o evento entrou no Google com o convidado anexado —
   * é o Google quem envia. Sem conexão, ou com a sincronização falhando, a
   * reserva vale mas ninguém foi avisado, e quem conta isso para a pessoa
   * precisa saber a diferença.
   */
  invited: boolean
  reused: boolean
}

/**
 * Reserva um horário e cria o evento com Meet.
 *
 * A ordem importa. Primeiro reservamos no banco, que é onde a corrida é
 * resolvida; só depois falamos com o Google. Se o Google falhar, a reserva
 * continua de pé e volta com um aviso — perder a reserva porque a API de fora
 * piscou seria trocar um problema pequeno por um grande, já que o horário some
 * e o cliente não é avisado.
 */
export async function createBooking(
  input: CreateBookingInput,
): Promise<BookingResult> {
  const admin = requireAdmin()
  const page = input.page
  if (page.require_phone && !input.phone)
    throw new BookingError(422, 'phone_required', 'Informe seu telefone.')

  const idempotencyKey = input.idempotencyKey ?? randomUUID()
  const existing = await admin
    .from('bookings')
    .select(
      'id,guest_email,start_at,end_at,timezone,meet_url,status,google_event_id',
    )
    .eq('workspace_id', page.workspace_id)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    if (existing.data.guest_email !== input.email.toLowerCase())
      throw new BookingError(
        409,
        'idempotency_conflict',
        'Identificador de reserva já utilizado.',
      )
    if (!['pending', 'confirmed'].includes(existing.data.status))
      throw new BookingError(
        409,
        'booking_closed',
        'Esta tentativa de reserva já foi encerrada. Escolha o horário novamente.',
      )
    return {
      id: existing.data.id,
      startAt: existing.data.start_at,
      endAt: existing.data.end_at,
      timezone: existing.data.timezone,
      meetUrl: existing.data.meet_url,
      status: existing.data.status,
      warning: null,
      // Reserva reaproveitada: o convite, se houve, saiu na primeira vez.
      invited: Boolean(existing.data.google_event_id),
      reused: true,
    }
  }

  const date = localDateInZone(input.startAt, page.timezone)
  const slot = (await findAvailableSlots(page, date, date)).find(
    (item) => item.startAt === input.startAt,
  )
  if (!slot)
    throw new BookingError(
      409,
      'slot_unavailable',
      'Este horário não está mais disponível. Escolha outro.',
    )

  const contactId = await resolveContact({
    workspaceId: page.workspace_id,
    contactId: input.contactId,
    name: input.name,
    email: input.email,
    phone: input.phone,
  })

  const reservation = await admin.rpc('reserve_calendar_booking', {
    target_booking_page_id: page.id,
    target_contact_id: contactId,
    target_guest_name: input.name,
    target_guest_email: input.email,
    target_guest_phone: input.phone ?? null,
    target_start_at: slot.startAt,
    target_end_at: slot.endAt,
    target_timezone: page.timezone,
    target_source: input.source,
    target_notes: input.notes ?? null,
    target_idempotency_key: idempotencyKey,
  })
  if (reservation.error) {
    if (reservation.error.message.includes('booking_slot_unavailable'))
      throw new BookingError(
        409,
        'slot_taken',
        'Este horário acabou de ser reservado. Escolha outro.',
      )
    throw reservation.error
  }
  const bookingId = reservation.data as string

  const bookingResult = await admin
    .from('bookings')
    .select('id,status,start_at,end_at,timezone,meet_url')
    .eq('workspace_id', page.workspace_id)
    .eq('id', bookingId)
    .single()
  if (bookingResult.error) throw bookingResult.error
  if (!['pending', 'confirmed'].includes(bookingResult.data.status))
    throw new BookingError(
      409,
      'booking_closed',
      'Esta tentativa de reserva já foi encerrada. Escolha o horário novamente.',
    )

  const { data: event, error: eventError } = await admin
    .from('calendar_events')
    .select('id,title,description,start_at,end_at')
    .eq('workspace_id', page.workspace_id)
    .eq('booking_id', bookingId)
    .limit(1)
    .single()
  if (eventError) throw eventError

  let meetUrl: string | null = null
  let warning: string | null = null
  let invited = false
  if (page.calendar_connection_id) {
    try {
      const google = await upsertGoogleEvent({
        workspaceId: page.workspace_id,
        connectionId: page.calendar_connection_id,
        event: {
          localId: event.id,
          calendarId: page.calendar_id,
          title: event.title,
          description: event.description,
          startAt: event.start_at,
          endAt: event.end_at,
          allDay: false,
          timezone: page.timezone,
          createMeet: page.create_meet,
          attendees: [{ email: input.email, displayName: input.name }],
        },
      })
      meetUrl =
        google.hangoutLink ??
        google.conferenceData?.entryPoints?.find(
          (entry) => entry.entryPointType === 'video',
        )?.uri ??
        null
      await admin
        .from('calendar_events')
        .update({
          provider_event_id: google.id,
          status: 'confirmed',
          meet_url: meetUrl,
          html_link: google.htmlLink ?? null,
          last_synced_at: new Date().toISOString(),
          sync_error: null,
        })
        .eq('id', event.id)
      await admin
        .from('bookings')
        .update({ google_event_id: google.id, meet_url: meetUrl })
        .eq('id', bookingId)
      // O Google só dispara o convite porque o evento foi criado com o
      // convidado anexado; é este ponto, e nenhum outro, que autoriza dizer
      // à pessoa que ela vai receber alguma coisa.
      invited = true
    } catch {
      warning =
        'Sua reserva foi confirmada, mas o convite Google será sincronizado pela equipe.'
      await admin
        .from('calendar_events')
        .update({ status: 'sync_error', sync_error: 'google_sync_failed' })
        .eq('id', event.id)
    }
  }
  await admin
    .from('bookings')
    .update({ calendar_event_id: event.id })
    .eq('id', bookingId)

  return {
    id: bookingId,
    startAt: bookingResult.data.start_at,
    endAt: bookingResult.data.end_at,
    timezone: bookingResult.data.timezone,
    meetUrl: meetUrl ?? bookingResult.data.meet_url,
    status: bookingResult.data.status,
    warning,
    invited,
    reused: false,
  }
}

/** O que precisamos do evento para desfazer o vínculo no Google. */
type CalendarEventLink = {
  id: string
  calendar_connection_id: string | null
  provider_event_id: string | null
  calendar_id: string | null
}

/** Carrega uma reserva junto do evento, que é quem guarda o vínculo Google. */
async function loadBookingWithEvent(input: {
  workspaceId: string
  bookingId: string
}) {
  const { data, error } = await requireAdmin()
    .from('bookings')
    // A chave é nomeada porque existem duas entre estas tabelas: `bookings`
    // aponta para o evento e o evento aponta de volta para a reserva. Sem dizer
    // qual delas, o PostgREST recusa a consulta inteira por ambiguidade — e o
    // efeito era um 500 em todo cancelamento.
    //
    // A escolhida é a que sai da reserva para o evento: é uma relação para um,
    // então a resposta vem como objeto e não como lista.
    .select(
      'id,status,start_at,end_at,timezone,guest_name,guest_email,guest_phone,contact_id,booking_page_id,calendar_event_id,calendar_events!bookings_calendar_event_id_fkey(id,calendar_connection_id,provider_event_id,calendar_id)',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.bookingId)
    .maybeSingle()
  if (error) throw error
  if (!data)
    throw new BookingError(
      404,
      'booking_not_found',
      'Agendamento não encontrado.',
    )
  // O Supabase tipa a relação embutida como lista, porque `calendar_events`
  // aponta para `bookings`. Na prática é um evento por reserva — a RPC cria
  // exatamente um —, então normalizamos aqui em vez de espalhar índices.
  //
  // O tipo de retorno é declarado porque a inferência trata o primeiro item
  // como sempre presente; uma lista vazia é possível se o evento for apagado
  // por fora, e é justamente esse caso que os guardas adiante tratam.
  const events: Array<CalendarEventLink> = Array.isArray(data.calendar_events)
    ? data.calendar_events
    : [data.calendar_events]
  // Devolvido ao lado da reserva, e não dentro dela: remontar o objeto fazia a
  // inferência perder a nulidade, e os guardas viravam código morto aos olhos
  // do lint mesmo sendo necessários em tempo de execução.
  return { booking: data, event: events.length ? events[0] : null }
}

/**
 * Cancela a reserva e apaga o evento no Google.
 *
 * A ordem é a inversa da criação: o Google primeiro. Um evento que sobrevive ao
 * cancelamento continua bloqueando o horário e chamando as pessoas para uma
 * reunião que não existe mais — pior do que um cancelamento que falhou inteiro e
 * pode ser repetido.
 */
export async function cancelBooking(input: {
  workspaceId: string
  bookingId: string
  reason?: string | null
}) {
  const admin = requireAdmin()
  const { booking, event } = await loadBookingWithEvent(input)
  if (['cancelled', 'completed', 'no_show'].includes(booking.status))
    return { id: booking.id, status: booking.status, alreadyClosed: true }
  if (event?.calendar_connection_id && event.provider_event_id)
    await deleteGoogleEvent({
      workspaceId: input.workspaceId,
      connectionId: event.calendar_connection_id,
      providerEventId: event.provider_event_id,
      calendarId: event.calendar_id ?? 'primary',
    })
  const updated = await admin
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.bookingId)
  if (updated.error) throw updated.error
  if (event?.id)
    await admin
      .from('calendar_events')
      .update({
        status: 'cancelled',
        metadata: { cancelReason: input.reason ?? null },
      })
      .eq('workspace_id', input.workspaceId)
      .eq('id', event.id)
  return { id: booking.id, status: 'cancelled', alreadyClosed: false }
}

/**
 * Remarca: cancela o horário antigo e reserva o novo.
 *
 * Reservar antes de cancelar seria mais seguro para o cliente, mas o horário
 * antigo ainda ocuparia a agenda e poderia derrubar o novo por sobreposição
 * quando os dois são próximos. Cancelar primeiro é o que faz o caso comum —
 * empurrar a reunião meia hora — simplesmente funcionar.
 */
export async function rescheduleBooking(input: {
  workspaceId: string
  bookingId: string
  startAt: string
  reason?: string | null
}): Promise<BookingResult> {
  const { booking } = await loadBookingWithEvent(input)
  if (!['pending', 'confirmed'].includes(booking.status))
    throw new BookingError(
      409,
      'booking_closed',
      'Este agendamento não está mais ativo.',
    )
  const page = await loadBookingPageForWorkspace({
    workspaceId: input.workspaceId,
    pageId: booking.booking_page_id,
  })
  await cancelBooking({
    workspaceId: input.workspaceId,
    bookingId: input.bookingId,
    reason: input.reason ?? 'reagendado',
  })
  try {
    return await createBooking({
      page,
      name: booking.guest_name,
      email: booking.guest_email,
      phone: booking.guest_phone,
      notes: input.reason ?? null,
      startAt: input.startAt,
      source: 'manual',
      contactId: booking.contact_id,
    })
  } catch (error) {
    // O horário novo não entrou e o antigo já foi solto. Dizer isso é melhor do
    // que um erro genérico: quem recebe precisa saber que ficou sem reunião.
    if (error instanceof BookingError)
      throw new BookingError(
        error.status,
        error.code,
        `${error.message} O horário anterior foi liberado, então escolha um novo.`,
      )
    throw error
  }
}
