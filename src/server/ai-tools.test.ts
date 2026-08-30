import { describe, expect, it } from 'vitest'
import {
  AGENDA_TOOLS,
  bookingGuidance,
  parseSlotInstant,
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

describe('bookingGuidance', () => {
  /**
   * Este caso saiu de um teste em produção.
   *
   * Sem Google conectado, a IA marcou a reunião e escreveu "o convite foi
   * enviado para joana.ribeiro@example.com". Nenhum convite existiu: sem
   * conexão, nada é enviado. A pessoa procuraria um e-mail que nunca chegaria.
   */
  it('não afirma convite quando nenhum foi enviado', () => {
    const texto = bookingGuidance({
      meetUrl: null,
      invited: false,
      email: 'joana@example.com',
    })
    expect(texto).not.toContain('joana@example.com')
    expect(texto).toContain('Nenhum convite foi enviado')
  })

  it('afirma o convite quando ele saiu de verdade', () => {
    const texto = bookingGuidance({
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      invited: true,
      email: 'joana@example.com',
    })
    expect(texto).toContain('O convite foi enviado para joana@example.com')
    expect(texto).toContain('Mande o link do Meet')
  })

  it('proíbe prometer link quando o Meet não saiu', () => {
    const texto = bookingGuidance({
      meetUrl: null,
      invited: true,
      email: 'joana@example.com',
    })
    expect(texto).toContain('não prometa nenhum')
    // O convite pode existir sem Meet: um evento no Google sem videoconferência
    // ainda avisa o convidado. As duas afirmações são independentes.
    expect(texto).toContain('O convite foi enviado')
  })

  it('nunca vaza o e-mail numa reserva sem convite', () => {
    for (const meetUrl of [null, 'https://meet.google.com/x']) {
      const texto = bookingGuidance({
        meetUrl,
        invited: false,
        email: 'segredo@example.com',
      })
      expect(texto).not.toContain('segredo@example.com')
    }
  })
})

describe('parseSlotInstant', () => {
  /**
   * Também veio de um teste em produção.
   *
   * O modelo escreveu um horário por conta própria em vez de copiar o que a
   * ferramenta devolveu. O processo roda em UTC, então um texto sem fuso é lido
   * como UTC: "13h" pedido em Brasília vira 10h. O que torna isso perigoso é
   * que 10h também é um horário válido da agenda — a reserva não falha, ela
   * acontece três horas fora e ninguém percebe até a reunião.
   */
  it('recusa horário sem fuso', () => {
    expect(parseSlotInstant('2026-09-02T13:00:00')).toBeNull()
    expect(parseSlotInstant('2026-09-02 13:00')).toBeNull()
    expect(parseSlotInstant('02/09/2026 13:00')).toBeNull()
    expect(parseSlotInstant('amanhã às 13h')).toBeNull()
  })

  it('aceita o formato que a própria ferramenta devolve', () => {
    expect(parseSlotInstant('2026-09-02T13:00:00.000Z')).toBe(
      '2026-09-02T13:00:00.000Z',
    )
  })

  it('aceita deslocamento explícito e normaliza para UTC', () => {
    // 10h em Brasília é 13h em UTC. As duas formas descrevem o mesmo instante,
    // e é justamente por serem inequívocas que ambas são aceitas.
    expect(parseSlotInstant('2026-09-02T10:00:00-03:00')).toBe(
      '2026-09-02T13:00:00.000Z',
    )
  })

  it('recusa o que não é texto ou não é data', () => {
    expect(parseSlotInstant(null)).toBeNull()
    expect(parseSlotInstant(1_756_819_200_000)).toBeNull()
    expect(parseSlotInstant('2026-13-45T99:00:00Z')).toBeNull()
  })
})
