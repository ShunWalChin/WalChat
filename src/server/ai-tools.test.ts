import { describe, expect, it } from 'vitest'
import {
  AGENDA_TOOLS,
  MAX_SLOTS_OFFERED,
  formatSlotLabel,
  isToolName,
  spreadSlots,
  toolFailure,
  toolSuccess,
  toolsForMode,
} from './ai-tools'

describe('catálogo de ferramentas', () => {
  /**
   * A invariante de segurança do módulo, escrita como teste.
   *
   * Enquanto nenhuma ferramenta tiver um campo de identificação, não existe
   * frase que o lead possa escrever para fazer a IA agir sobre a agenda de
   * outra pessoa: o modelo não tem onde colocar o alvo. No dia em que alguém
   * adicionar `contactId` por conveniência, este teste quebra antes do deploy.
   */
  it('nenhuma ferramenta aceita identificador de quem', () => {
    const proibidos = [
      'contactid',
      'workspaceid',
      'bookingid',
      'contato_id',
      'agendamentoid',
      'userid',
      'email_do_contato',
    ]
    for (const tool of AGENDA_TOOLS)
      for (const campo of Object.keys(tool.parameters.properties ?? {}))
        expect(
          proibidos.includes(campo.toLowerCase().replace(/[_-]/g, '')),
          `${tool.name}.${campo} identifica um alvo`,
        ).toBe(false)
  })

  it('marcar, remarcar e cancelar não existem no modo copiloto', () => {
    const copiloto = toolsForMode('copilot').map((tool) => tool.name)
    expect(copiloto).toEqual([
      'consultar_horarios',
      'consultar_meus_agendamentos',
    ])
    expect(copiloto).not.toContain('agendar_reuniao')
    expect(copiloto).not.toContain('cancelar_reuniao')
    expect(copiloto).not.toContain('remarcar_reuniao')
  })

  it('o modo autônomo recebe o catálogo inteiro', () => {
    expect(toolsForMode('autonomous')).toHaveLength(AGENDA_TOOLS.length)
  })

  it('todo campo declarado é obrigatório', () => {
    // A OpenAI recusa o modo `strict` quando um campo do schema fica de fora
    // de `required`. Como toda ferramenta é publicada em modo estrito, um
    // campo opcional derrubaria a chamada em produção, não aqui.
    for (const tool of AGENDA_TOOLS)
      expect(tool.parameters.required ?? []).toEqual(
        Object.keys(tool.parameters.properties ?? {}),
      )
  })

  it('só reconhece nome que existe no catálogo', () => {
    expect(isToolName('agendar_reuniao')).toBe(true)
    expect(isToolName('apagar_agenda')).toBe(false)
    expect(isToolName(null)).toBe(false)
  })
})

describe('resposta de ferramenta', () => {
  it('sucesso e falha se distinguem pelo campo ok', () => {
    expect(JSON.parse(toolSuccess({ linkMeet: 'x' }))).toEqual({
      ok: true,
      linkMeet: 'x',
    })
    expect(
      JSON.parse(toolFailure('sem_horarios', 'ofereça outra data')),
    ).toEqual({
      ok: false,
      code: 'sem_horarios',
      orientacao: 'ofereça outra data',
    })
  })
})

describe('spreadSlots', () => {
  const slot = (localDate: string, hora: string) => ({
    localDate,
    startAt: `${localDate}T${hora}:00.000Z`,
  })

  it('espalha as opções pelos dias em vez de esgotar o primeiro', () => {
    const escolhidos = spreadSlots(
      [
        slot('2026-09-01', '12:00'),
        slot('2026-09-01', '13:00'),
        slot('2026-09-01', '14:00'),
        slot('2026-09-02', '12:00'),
        slot('2026-09-02', '13:00'),
        slot('2026-09-03', '12:00'),
      ],
      3,
    )
    expect(escolhidos.map((item) => item.localDate)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ])
  })

  it('completa com o segundo horário do dia quando faltam dias', () => {
    const escolhidos = spreadSlots(
      [
        slot('2026-09-01', '12:00'),
        slot('2026-09-01', '13:00'),
        slot('2026-09-02', '12:00'),
      ],
      3,
    )
    expect(escolhidos).toHaveLength(3)
    expect(escolhidos[2].startAt).toBe('2026-09-01T13:00:00.000Z')
  })

  it('não inventa horários quando há menos que o limite', () => {
    expect(spreadSlots([slot('2026-09-01', '12:00')])).toHaveLength(1)
  })

  it('respeita o teto padrão', () => {
    const muitos = Array.from({ length: 40 }, (_, index) =>
      slot(`2026-09-${String((index % 20) + 1).padStart(2, '0')}`, '12:00'),
    )
    expect(spreadSlots(muitos)).toHaveLength(MAX_SLOTS_OFFERED)
  })

  it('não repete o mesmo horário', () => {
    const escolhidos = spreadSlots(
      [
        slot('2026-09-01', '12:00'),
        slot('2026-09-01', '13:00'),
        slot('2026-09-02', '12:00'),
        slot('2026-09-02', '13:00'),
      ],
      4,
    )
    expect(new Set(escolhidos.map((item) => item.startAt)).size).toBe(4)
  })
})

describe('formatSlotLabel', () => {
  it('mostra a hora no fuso da agenda, não em UTC', () => {
    // 14:00Z é 11:00 em São Paulo. Rotular em UTC mandaria o cliente para a
    // reunião três horas depois.
    const rotulo = formatSlotLabel(
      '2026-09-01T14:00:00.000Z',
      'America/Sao_Paulo',
    )
    expect(rotulo).toContain('11:00')
    expect(rotulo).toContain('01/09')
  })

  it('acompanha o fuso quando ele muda', () => {
    expect(formatSlotLabel('2026-09-01T14:00:00.000Z', 'UTC')).toContain(
      '14:00',
    )
  })
})
