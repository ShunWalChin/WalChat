/** Matriz unitária das regras que podem permitir ou bloquear uma mensagem Meta. */
import { describe, expect, it } from 'vitest'
import { evaluateCompliance, OPT_OUT_FOOTER } from './compliance'

const now = new Date('2026-07-21T12:00:00.000Z')

describe('evaluateCompliance', () => {
  it('permite automação dentro de 24h e adiciona opt-out', () => {
    const result = evaluateCompliance({
      now,
      lastInboundAt: '2026-07-21T11:00:00.000Z',
      isAutomated: true,
      message: 'Salve!',
    })
    expect(result.allowed).toBe(true)
    expect(result.policy).toBe('standard_24h')
    expect(result.body).toContain(OPT_OUT_FOOTER)
  })

  it('bloqueia automação fora de 24h', () => {
    const result = evaluateCompliance({
      now,
      lastInboundAt: '2026-07-20T10:00:00.000Z',
      isAutomated: true,
      message: 'Volta aqui',
    })
    expect(result).toMatchObject({ allowed: false, reason: 'outside_24h' })
  })

  it('permite HUMAN_AGENT apenas para atendimento humano em até 7 dias', () => {
    const human = evaluateCompliance({
      now,
      lastInboundAt: '2026-07-18T12:00:00.000Z',
      isAutomated: false,
      message: 'Como posso ajudar?',
      requestedTag: 'HUMAN_AGENT',
    })
    const bot = evaluateCompliance({
      now,
      lastInboundAt: '2026-07-18T12:00:00.000Z',
      isAutomated: true,
      message: 'Oferta',
      requestedTag: 'HUMAN_AGENT',
    })
    expect(human).toMatchObject({
      allowed: true,
      policy: 'human_agent_7d',
      tag: 'HUMAN_AGENT',
    })
    expect(bot).toMatchObject({
      allowed: false,
      reason: 'human_agent_is_not_automation',
    })
  })

  it('bloqueia opt-out, cooldown, private reply duplicada e blocklist', () => {
    expect(
      evaluateCompliance({
        now,
        lastInboundAt: now,
        optedOutAt: now,
        isAutomated: true,
        message: 'Oi',
      }).reason,
    ).toBe('opted_out')
    expect(
      evaluateCompliance({
        now,
        lastInboundAt: now,
        triggerLastFiredAt: '2026-07-21T11:30:00.000Z',
        isAutomated: true,
        message: 'Oi',
      }).reason,
    ).toBe('trigger_cooldown')
    expect(
      evaluateCompliance({
        now,
        lastInboundAt: now,
        instagramCommentId: 'comment_1',
        commentAlreadyReplied: true,
        isAutomated: true,
        message: 'Oi',
      }).reason,
    ).toBe('comment_already_replied')
    expect(
      evaluateCompliance({
        now,
        lastInboundAt: now,
        isAutomated: true,
        message: 'GANHE DINHEIRO rápido',
        blocklist: ['ganhe dinheiro'],
      }).reason,
    ).toBe('blocked_content')
  })
})
