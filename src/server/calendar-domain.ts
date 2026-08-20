/** Regras puras de datas e disponibilidade usadas pelo calendário e testes. */
export type AvailabilityWindow = { start: string; end: string }
export type WeeklyAvailability = Record<string, AvailabilityWindow[]>
export type BusyRange = { start: string; end: string }

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/

export function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

export function isWeeklyAvailability(
  value: unknown,
): value is WeeklyAvailability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([day, windows]) => {
    if (!/^[0-6]$/.test(day) || !Array.isArray(windows)) return false
    return windows.every((window) => {
      if (!window || typeof window !== 'object') return false
      const item = window as Record<string, unknown>
      return (
        typeof item.start === 'string' &&
        typeof item.end === 'string' &&
        timePattern.test(item.start) &&
        timePattern.test(item.end) &&
        item.start < item.end
      )
    })
  })
}

function partsInTimeZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

/** Converte horário civil IANA para UTC sem depender do timezone do processo. */
export function zonedDateTimeToUtc(
  localDate: string,
  localTime: string,
  timezone: string,
) {
  if (!datePattern.test(localDate) || !timePattern.test(localTime))
    throw new Error('invalid_local_datetime')
  if (!isValidTimeZone(timezone)) throw new Error('invalid_timezone')
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = localTime.split(':').map(Number)
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0)
  let instant = desired
  // Duas iterações resolvem offsets e transições DST usuais.
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = partsInTimeZone(new Date(instant), timezone)
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    )
    const correction = desired - represented
    instant += correction
    if (correction === 0) break
  }
  return new Date(instant)
}

function dateRange(from: string, to: string) {
  if (!datePattern.test(from) || !datePattern.test(to))
    throw new Error('invalid_date_range')
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const dates: string[] = []
  for (
    let cursor = start;
    cursor <= end;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    dates.push(cursor.toISOString().slice(0, 10))
    if (dates.length > 367) throw new Error('date_range_too_large')
  }
  return dates
}

function overlaps(start: number, end: number, busy: BusyRange[]) {
  return busy.some((range) => {
    const busyStart = new Date(range.start).getTime()
    const busyEnd = new Date(range.end).getTime()
    return start < busyEnd && end > busyStart
  })
}

export type AvailableSlot = {
  startAt: string
  endAt: string
  localDate: string
  localTime: string
}

export function generateAvailableSlots(input: {
  from: string
  to: string
  timezone: string
  availability: WeeklyAvailability
  durationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  minimumNoticeMinutes: number
  maxAdvanceDays: number
  busy: BusyRange[]
  now?: Date
}) {
  const now = input.now ?? new Date()
  const earliest = now.getTime() + input.minimumNoticeMinutes * 60_000
  const latest = now.getTime() + input.maxAdvanceDays * 86_400_000
  const busyWithBuffers = input.busy.map((range) => ({
    start: new Date(
      new Date(range.start).getTime() - input.bufferBeforeMinutes * 60_000,
    ).toISOString(),
    end: new Date(
      new Date(range.end).getTime() + input.bufferAfterMinutes * 60_000,
    ).toISOString(),
  }))
  const slots: AvailableSlot[] = []
  for (const localDate of dateRange(input.from, input.to)) {
    const weekday = new Date(`${localDate}T12:00:00.000Z`).getUTCDay()
    for (const window of input.availability[String(weekday)] ?? []) {
      const windowStart = zonedDateTimeToUtc(
        localDate,
        window.start,
        input.timezone,
      ).getTime()
      const windowEnd = zonedDateTimeToUtc(
        localDate,
        window.end,
        input.timezone,
      ).getTime()
      for (
        let start = windowStart;
        start + input.durationMinutes * 60_000 <= windowEnd;
        start += input.durationMinutes * 60_000
      ) {
        const end = start + input.durationMinutes * 60_000
        if (start < earliest || start > latest) continue
        if (
          overlaps(
            start - input.bufferBeforeMinutes * 60_000,
            end + input.bufferAfterMinutes * 60_000,
            busyWithBuffers,
          )
        )
          continue
        slots.push({
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          localDate,
          localTime: new Intl.DateTimeFormat('pt-BR', {
            timeZone: input.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(new Date(start)),
        })
      }
    }
  }
  return slots
}

export function normalizeBookingSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
