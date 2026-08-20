import { describe, expect, it } from 'vitest'
import {
  generateAvailableSlots,
  isWeeklyAvailability,
  normalizeBookingSlug,
  zonedDateTimeToUtc,
} from './calendar-domain'

describe('calendar domain', () => {
  it('converte horário de São Paulo para UTC', () => {
    expect(
      zonedDateTimeToUtc(
        '2026-08-24',
        '09:00',
        'America/Sao_Paulo',
      ).toISOString(),
    ).toBe('2026-08-24T12:00:00.000Z')
  })

  it('remove slots ocupados e respeita buffers', () => {
    const slots = generateAvailableSlots({
      from: '2026-08-24',
      to: '2026-08-24',
      timezone: 'America/Sao_Paulo',
      availability: { '1': [{ start: '09:00', end: '11:00' }] },
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 15,
      minimumNoticeMinutes: 0,
      maxAdvanceDays: 365,
      busy: [
        { start: '2026-08-24T12:30:00.000Z', end: '2026-08-24T13:00:00.000Z' },
      ],
      now: new Date('2026-08-20T12:00:00.000Z'),
    })
    expect(slots.map((slot) => slot.localTime)).toEqual(['10:30'])
  })

  it('valida agenda semanal e normaliza slug', () => {
    expect(
      isWeeklyAvailability({ '1': [{ start: '09:00', end: '18:00' }] }),
    ).toBe(true)
    expect(isWeeklyAvailability({ '9': [] })).toBe(false)
    expect(normalizeBookingSlug('Mentoria do Wal — 30 min')).toBe(
      'mentoria-do-wal-30-min',
    )
  })
})
