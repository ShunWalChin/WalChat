/** Matriz unitária das regras que podem permitir ou bloquear uma mensagem Meta. */
import { describe, expect, it } from 'vitest'
import {
  evaluateCompliance,
  evaluateWhatsAppCompliance,
  MAX_META_TEXT_CHARS,
  OPT_OUT_FOOTER,
  withOptOut,
} from './compliance'

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

  it('trata private reply como janela própria de 7 dias, sem abrir DM comum', () => {
    const allowed = evaluateCompliance({
      now,
      lastInboundAt: null,
      instagramCommentId: 'comment_2',
      commentCreatedAt: '2026-07-15T12:00:01.000Z',
      isAutomated: true,
      message: 'Te mandei os detalhes.',
    })
    const expired = evaluateCompliance({
      now,
      lastInboundAt: null,
      instagramCommentId: 'comment_3',
      commentCreatedAt: '2026-07-14T11:59:59.000Z',
      isAutomated: true,
      message: 'Te mandei os detalhes.',
    })
    expect(allowed).toMatchObject({
      allowed: true,
      policy: 'private_reply_7d',
    })
    expect(expired).toMatchObject({
      allowed: false,
      reason: 'outside_private_reply_window',
    })
  })

  it('mantém o rodapé no fim sem exceder o limite do texto Meta', () => {
    const body = withOptOut(`${'a'.repeat(1_200)}\n\n${OPT_OUT_FOOTER}`)
    expect(body).toHaveLength(MAX_META_TEXT_CHARS)
    expect(body.endsWith(OPT_OUT_FOOTER)).toBe(true)
    expect(body.match(/Responda PARAR/g)).toHaveLength(1)
  })

  it('normaliza Unicode invisível e ignora termos vazios da blocklist', () => {
    const blocked = evaluateCompliance({
      now,
      lastInboundAt: now,
      isAutomated: true,
      message: 'GANHE\u200B DINHEIRO agora',
      blocklist: ['', 'ganhe dinheiro'],
    })
    const allowed = evaluateCompliance({
      now,
      lastInboundAt: now,
      isAutomated: true,
      message: 'Mensagem legítima',
      blocklist: ['   '],
    })
    expect(blocked.reason).toBe('blocked_content')
    expect(allowed.allowed).toBe(true)
  })

  it('bloqueia timestamps inbound muito no futuro', () => {
    expect(
      evaluateCompliance({
        now,
        lastInboundAt: '2026-07-21T13:00:00.000Z',
        isAutomated: true,
        message: 'Oi',
      }).reason,
    ).toBe('invalid_interaction_time')
  })
})

describe('evaluateWhatsAppCompliance', () => {
  it('permite texto livre apenas dentro da janela e adiciona opt-out em automação', () => {
    const allowed = evaluateWhatsAppCompliance({
      now,
      lastInboundAt: '2026-07-21T11:00:00.000Z',
      isAutomated: true,
      message: 'Recebi sua mensagem.',
    })
    const expired = evaluateWhatsAppCompliance({
      now,
      lastInboundAt: '2026-07-20T11:00:00.000Z',
      isAutomated: false,
      message: 'Olá',
    })
    expect(allowed).toMatchObject({ allowed: true, policy: 'standard_24h' })
    expect(allowed.body.endsWith(OPT_OUT_FOOTER)).toBe(true)
    expect(expired.reason).toBe('whatsapp_template_required')
  })

  it('fora de 24h aceita somente template aprovado', () => {
    const base = {
      now,
      lastInboundAt: null,
      isAutomated: false,
      message: 'retomada',
    }
    expect(
      evaluateWhatsAppCompliance({
        ...base,
        template: {
          name: 'retomada',
          language: 'pt_BR',
          status: 'APPROVED',
          hasOptOut: false,
        },
      }),
    ).toMatchObject({ allowed: true, policy: 'whatsapp_template' })
    expect(
      evaluateWhatsAppCompliance({
        ...base,
        template: {
          name: 'retomada',
          language: 'pt_BR',
          status: 'PENDING',
          hasOptOut: true,
        },
      }).reason,
    ).toBe('whatsapp_template_not_approved')
  })

  it('exige opt-out em template usado por automação', () => {
    expect(
      evaluateWhatsAppCompliance({
        now,
        lastInboundAt: null,
        isAutomated: true,
        message: 'retomada',
        template: {
          name: 'retomada',
          language: 'pt_BR',
          status: 'APPROVED',
          hasOptOut: false,
        },
      }).reason,
    ).toBe('whatsapp_template_missing_opt_out')
  })
})
