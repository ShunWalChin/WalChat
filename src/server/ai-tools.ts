/**
 * Ferramentas de agenda que a IA pode acionar durante a conversa.
 *
 * Este módulo é puro: define o contrato das ferramentas e como o resultado vira
 * texto para o modelo ler. A execução, que toca banco e Google, fica em
 * `ai-tools.server.ts`. A separação existe para que o contrato possa ser testado
 * sem rede — é ele que determina o que o modelo consegue pedir.
 *
 * A decisão de segurança que organiza o arquivo inteiro: **o modelo escolhe o
 * quê, nunca de quem.** Nenhuma ferramenta aceita identificador de contato, de
 * workspace ou de agendamento. Esses valores vêm do contexto da conversa, que é
 * confiável, e são injetados pelo executor. Se `cancelar_reuniao` recebesse um
 * id, bastaria o lead escrever "cancele o agendamento fulano-de-tal" para o
 * modelo repassar — e a IA viraria uma porta para mexer na agenda alheia.
 *
 * Por isso remarcar e cancelar agem sempre sobre a próxima reunião *daquele*
 * contato. É o que a pessoa quer dizer quando fala "preciso remarcar", e é a
 * única coisa que ela tem direito de fazer.
 */

import type { JSONSchema7 } from 'json-schema'

/** Teto de idas e voltas com ferramenta numa mesma resposta. */
export const MAX_TOOL_ROUNDS = 3

/** Quantos horários oferecemos por vez, para o texto caber num direct. */
export const MAX_SLOTS_OFFERED = 6

export type ToolName =
  | 'consultar_horarios'
  | 'agendar_reuniao'
  | 'consultar_meus_agendamentos'
  | 'remarcar_reuniao'
  | 'cancelar_reuniao'

export type ToolDefinition = {
  name: ToolName
  description: string
  /**
   * Schema em JSON Schema puro, e não em Zod, porque os dois provedores o
   * consomem: a OpenAI recebe direto e o SDK do Gemini o embrulha. Uma única
   * definição impede que os provedores divirjam no que aceitam.
   */
  parameters: JSONSchema7 & { type: 'object' }
}

/**
 * O catálogo.
 *
 * As descrições são escritas para o modelo, não para nós: dizem quando usar e,
 * principalmente, o que não fazer. A instrução de não inventar horário é a mais
 * importante — sem ela o modelo oferece "amanhã às 15h" porque soa razoável, e a
 * reserva falha na frente do cliente.
 */
export const AGENDA_TOOLS: Array<ToolDefinition> = [
  {
    name: 'consultar_horarios',
    description:
      'Lista os horários realmente livres na agenda. Use antes de propor qualquer horário. Nunca invente ou suponha um horário: só ofereça os que esta ferramenta devolver.',
    parameters: {
      type: 'object',
      properties: {
        dias: {
          type: 'integer',
          minimum: 1,
          maximum: 30,
          description:
            'Quantos dias à frente procurar, a partir de hoje. Use 7 quando a pessoa não especificar.',
        },
      },
      required: ['dias'],
      additionalProperties: false,
    },
  },
  {
    name: 'agendar_reuniao',
    description:
      'Reserva um horário e cria a reunião com link do Google Meet. Só chame depois de ter o nome e o e-mail da pessoa e depois que ela escolher um horário que veio de consultar_horarios. O e-mail é obrigatório porque é para onde vai o convite.',
    parameters: {
      type: 'object',
      properties: {
        inicio: {
          type: 'string',
          description:
            'O horário escolhido, exatamente como veio no campo "inicio" de consultar_horarios.',
        },
        nome: {
          type: 'string',
          description: 'Nome de quem vai participar, como a pessoa informou.',
        },
        email: {
          type: 'string',
          description: 'E-mail de quem vai participar. Peça se não tiver.',
        },
        observacao: {
          type: 'string',
          description:
            'Assunto da conversa em uma frase, ou vazio se não houver.',
        },
      },
      required: ['inicio', 'nome', 'email', 'observacao'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_meus_agendamentos',
    description:
      'Mostra as próximas reuniões já marcadas com esta mesma pessoa. Use quando ela perguntar quando é a reunião, ou antes de remarcar e cancelar.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'remarcar_reuniao',
    description:
      'Move a próxima reunião desta pessoa para outro horário. O horário novo precisa ter vindo de consultar_horarios.',
    parameters: {
      type: 'object',
      properties: {
        inicio: {
          type: 'string',
          description: 'O novo horário, como veio de consultar_horarios.',
        },
      },
      required: ['inicio'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancelar_reuniao',
    description:
      'Cancela a próxima reunião desta pessoa e libera o horário. Confirme com ela antes de chamar.',
    parameters: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description: 'Motivo em poucas palavras, ou vazio.',
        },
      },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
]

export function isToolName(value: unknown): value is ToolName {
  return AGENDA_TOOLS.some((tool) => tool.name === value)
}

/** Data e hora legíveis no fuso da agenda, que é o fuso do cliente. */
export function formatSlotLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

/**
 * Empacota a resposta de uma ferramenta.
 *
 * Sempre JSON, sempre com `ok`. Um erro devolvido como texto solto faz o modelo
 * tratá-lo como conteúdo e repetir a mensagem crua para o cliente; com `ok:
 * false` e uma orientação, ele sabe que precisa contornar.
 */
export function toolSuccess(data: Record<string, unknown>) {
  return JSON.stringify({ ok: true, ...data })
}

export function toolFailure(code: string, orientacao: string) {
  return JSON.stringify({ ok: false, code, orientacao })
}

/**
 * Reduz a lista de horários ao que cabe numa mensagem.
 *
 * Espalha as opções pelos dias em vez de mandar as seis primeiras: seis horários
 * da mesma terça-feira não são uma escolha de verdade. Pegar um por dia, e só
 * então completar, é o que faz a oferta parecer uma agenda.
 */
export function spreadSlots<T extends { startAt: string; localDate: string }>(
  slots: Array<T>,
  limit = MAX_SLOTS_OFFERED,
): Array<T> {
  const porDia = new Map<string, Array<T>>()
  for (const slot of slots) {
    const lista = porDia.get(slot.localDate)
    if (lista) lista.push(slot)
    else porDia.set(slot.localDate, [slot])
  }
  const escolhidos: Array<T> = []
  let rodada = 0
  while (escolhidos.length < limit) {
    let avancou = false
    for (const lista of porDia.values()) {
      if (escolhidos.length >= limit) break
      if (rodada >= lista.length) continue
      escolhidos.push(lista[rodada])
      avancou = true
    }
    if (!avancou) break
    rodada++
  }
  return escolhidos
}

/**
 * Quais ferramentas cada modo pode usar.
 *
 * Esta é a distinção que evita o pior erro possível aqui. No modo copiloto a IA
 * escreve uma *sugestão* para uma pessoa revisar antes de enviar. Se ela pudesse
 * chamar `agendar_reuniao`, a reunião entraria na agenda no instante em que o
 * rascunho fosse gerado — mesmo que o operador lesse a sugestão e a descartasse.
 * A agenda teria uma reunião que ninguém marcou.
 *
 * Então o copiloto recebe só as ferramentas de leitura: a sugestão sai com
 * disponibilidade real, e nada acontece no mundo até um humano mandar. Marcar,
 * remarcar e cancelar ficam para o modo autônomo, onde a resposta já é a ação.
 */
const READ_ONLY_TOOLS: Array<ToolName> = [
  'consultar_horarios',
  'consultar_meus_agendamentos',
]

export function toolsForMode(mode: 'copilot' | 'autonomous') {
  return mode === 'autonomous'
    ? AGENDA_TOOLS
    : AGENDA_TOOLS.filter((tool) => READ_ONLY_TOOLS.includes(tool.name))
}
