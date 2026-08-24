import { describe, expect, it } from 'vitest'
import {
  campaignJobRunAt,
  campaignPreviewSummary,
  evaluateCampaignContact,
} from './campaign-domain'

const now = new Date('2026-08-24T12:00:00.000Z')

describe('campaign domain', () => {
  it('separa janela automática, atendimento humano e bloqueados', () => {
    const contacts = [
      ['a', '2026-08-24T11:00:00.000Z'],
      ['b', '2026-08-21T12:00:00.000Z'],
      ['c', '2026-08-10T12:00:00.000Z'],
    ].map(([id, lastInboundAt]) =>
      evaluateCampaignContact(
        {
          id,
          name: id,
          username: id,
          platform: 'instagram',
          lastInboundAt,
          optedOutAt: null,
        },
        'Olá',
        [],
        now,
      ),
    )
    expect(campaignPreviewSummary(contacts)).toMatchObject({
      eligible: 1,
      humanAgentOnly: 1,
      blocked: 1,
    })
  })

  it('distribui jobs sem ultrapassar a taxa por minuto', () => {
    expect(campaignJobRunAt(35, 35, now).toISOString()).toBe(
      '2026-08-24T12:01:00.000Z',
    )
  })
})
