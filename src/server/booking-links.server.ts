/** Resolve links públicos de agenda sem confiar em URLs vindas do cliente. */
import '@tanstack/react-start/server-only'
import { getServerEnv } from './env.server'
import { getSupabaseAdmin } from './supabase-admin.server'

export async function getActiveBookingLink(input: {
  workspaceId: string
  bookingPageId?: string | null
}) {
  if (!input.bookingPageId) return null
  const admin = getSupabaseAdmin()
  if (!admin) throw new Error('Supabase administrativo indisponível.')
  const { data, error } = await admin
    .from('booking_pages')
    .select('slug,title')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.bookingPageId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    title: data.title,
    url: `${getServerEnv().APP_ORIGIN}/agendar/${data.slug}`,
  }
}

export async function applyBookingLink(input: {
  workspaceId: string
  bookingPageId?: string | null
  message: string
}) {
  const booking = await getActiveBookingLink(input)
  if (!booking) return input.message.replaceAll('{{booking_link}}', '').trim()
  if (input.message.includes('{{booking_link}}'))
    return input.message.replaceAll('{{booking_link}}', booking.url)
  return `${input.message.trim()}\n\nAgende seu horário: ${booking.url}`
}
