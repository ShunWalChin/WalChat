import { z } from 'zod'
import {
  HUMAN_AGENT_WINDOW_MS,
  STANDARD_WINDOW_MS,
  evaluateCompliance,
  evaluateWhatsAppCompliance,
  withOptOut,
} from './compliance'

export const campaignDraftSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    message: z.string().trim().min(1).max(950),
    ratePerMinute: z.number().int().min(30).max(45),
    tagId: z.uuid().nullable().optional(),
    scheduledAt: z.iso.datetime().nullable().optional(),
  })
  .strict()

export type CampaignContactSnapshot = {
  id: string
  platform: 'instagram' | 'whatsapp' | 'manual'
  name: string
  username: string | null
  lastInboundAt: string | null
  optedOutAt: string | null
}

export type CampaignEligibility = {
  contactId: string
  name: string
  username: string | null
  platform: CampaignContactSnapshot['platform']
  eligibility: 'standard_24h' | 'human_agent_7d' | 'blocked'
  reason: string | null
  secondsLeft24h: number
}

export function evaluateCampaignContact(
  contact: CampaignContactSnapshot,
  message: string,
  blocklist: string[],
  now = new Date(),
): CampaignEligibility {
  if (contact.platform === 'manual')
    return {
      contactId: contact.id,
      name: contact.name,
      username: contact.username,
      platform: contact.platform,
      eligibility: 'blocked',
      reason: 'manual_contact_has_no_messaging_channel',
      secondsLeft24h: 0,
    }
  const decision =
    contact.platform === 'whatsapp'
      ? evaluateWhatsAppCompliance({
          now,
          lastInboundAt: contact.lastInboundAt,
          optedOutAt: contact.optedOutAt,
          isAutomated: true,
          message,
          blocklist,
        })
      : evaluateCompliance({
          now,
          lastInboundAt: contact.lastInboundAt,
          optedOutAt: contact.optedOutAt,
          isAutomated: true,
          message,
          blocklist,
        })
  if (decision.allowed)
    return {
      contactId: contact.id,
      name: contact.name,
      username: contact.username,
      platform: contact.platform,
      eligibility: 'standard_24h',
      reason: null,
      secondsLeft24h: decision.secondsLeft24h,
    }

  const inboundTime = contact.lastInboundAt
    ? new Date(contact.lastInboundAt).getTime()
    : Number.NaN
  const elapsed = now.getTime() - inboundTime
  const humanOnly =
    contact.platform === 'instagram' &&
    !contact.optedOutAt &&
    Number.isFinite(elapsed) &&
    elapsed > STANDARD_WINDOW_MS &&
    elapsed <= HUMAN_AGENT_WINDOW_MS
  return {
    contactId: contact.id,
    name: contact.name,
    username: contact.username,
    platform: contact.platform,
    eligibility: humanOnly ? 'human_agent_7d' : 'blocked',
    reason: humanOnly
      ? 'human_agent_requires_manual_service'
      : (decision.reason ?? 'not_eligible'),
    secondsLeft24h: decision.secondsLeft24h,
  }
}

export function campaignPreviewSummary(items: CampaignEligibility[]) {
  return {
    eligible: items.filter((item) => item.eligibility === 'standard_24h')
      .length,
    humanAgentOnly: items.filter(
      (item) => item.eligibility === 'human_agent_7d',
    ).length,
    blocked: items.filter((item) => item.eligibility === 'blocked').length,
    total: items.length,
  }
}

export function campaignBody(message: string) {
  return withOptOut(message)
}

export function campaignJobRunAt(
  index: number,
  ratePerMinute: number,
  startsAt: Date,
) {
  return new Date(
    startsAt.getTime() + Math.floor((index * 60_000) / ratePerMinute),
  )
}
