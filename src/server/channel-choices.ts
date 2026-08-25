/**
 * Traduz as escolhas de um nó para a forma nativa de cada canal.
 *
 * O contrato do DAG guarda uma lista única de `choices` para que o operador não
 * precise conhecer o limite de cada API. É aqui que ela vira quick reply no
 * Instagram e botão ou lista no WhatsApp, e é aqui que a resposta do contato
 * volta a virar a chave da escolha.
 *
 * Módulo puro de propósito: nenhuma chamada de rede, para que o mapeamento seja
 * testável e o mesmo código sirva ao simulador de fluxo.
 */
export type AutomationChoice = { key: string; label: string }

/** O Instagram aceita 13 quick replies; o WhatsApp, 10 itens de lista. */
export const MAX_CHOICES = 10
/** Acima de três opções o WhatsApp exige lista em vez de botões. */
export const WHATSAPP_BUTTON_LIMIT = 3

/** Prefixo que identifica um payload emitido por este produto. */
const PAYLOAD_PREFIX = 'wal'

/**
 * O nó vai no payload apenas para diagnóstico. O roteamento nunca confia nele:
 * quem decide o nó é a execução em espera no banco, não o texto que voltou do
 * cliente.
 */
export function choicePayload(nodeId: string, key: string) {
  return `${PAYLOAD_PREFIX}:${nodeId}:${key}`
}

function payloadKey(payload: string | null | undefined) {
  if (!payload) return null
  const parts = payload.split(':')
  if (parts.length !== 3 || parts[0] !== PAYLOAD_PREFIX) return null
  return parts[2] || null
}

/**
 * Mesma normalização do motor de compliance: NFKC, remoção de invisíveis e
 * caixa baixa. Sem isso, "Quero agendar" digitado com espaço duplo ou com um
 * zero-width no meio deixaria de casar com o rótulo do botão.
 */
function normalize(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR')
}

/**
 * Descobre qual escolha o contato selecionou.
 *
 * A ordem importa: o payload é a evidência mais forte, mas o contato também
 * pode digitar o rótulo em vez de tocar no botão — e isso acontece o tempo
 * todo. Cair no texto evita travar a conversa por causa disso.
 */
export function matchChoice(
  choices: Array<AutomationChoice>,
  reply: { text?: string | null; payload?: string | null },
): string | null {
  const fromPayload = payloadKey(reply.payload)
  if (fromPayload && choices.some((choice) => choice.key === fromPayload))
    return fromPayload

  const text = reply.text?.trim()
  if (!text) return null
  const normalized = normalize(text)

  const byLabel = choices.find(
    (choice) => normalize(choice.label) === normalized,
  )
  if (byLabel) return byLabel.key

  // Alguns clientes devolvem o id da opção como texto puro.
  const byKey = choices.find((choice) => normalize(choice.key) === normalized)
  return byKey?.key ?? null
}

/** Quick replies do Instagram: título até 20 e payload até 1000 caracteres. */
export function instagramQuickReplies(
  nodeId: string,
  choices: Array<AutomationChoice>,
) {
  return choices.slice(0, 13).map((choice) => ({
    content_type: 'text' as const,
    title: choice.label.slice(0, 20),
    payload: choicePayload(nodeId, choice.key).slice(0, 1_000),
  }))
}

export type WhatsAppInteractive =
  | {
      type: 'button'
      body: { text: string }
      action: {
        buttons: Array<{
          type: 'reply'
          reply: { id: string; title: string }
        }>
      }
    }
  | {
      type: 'list'
      body: { text: string }
      action: {
        button: string
        sections: Array<{
          rows: Array<{ id: string; title: string }>
        }>
      }
    }

/**
 * Escolhe entre botão e lista pela quantidade, que é exatamente o critério da
 * Cloud API. O operador não precisa saber disso ao montar o fluxo.
 */
export function whatsappInteractive(
  nodeId: string,
  body: string,
  choices: Array<AutomationChoice>,
): WhatsAppInteractive {
  // O corpo interativo do WhatsApp aceita 1024 caracteres.
  const text = body.slice(0, 1_024)
  if (choices.length <= WHATSAPP_BUTTON_LIMIT)
    return {
      type: 'button',
      body: { text },
      action: {
        buttons: choices.map((choice) => ({
          type: 'reply' as const,
          reply: {
            id: choicePayload(nodeId, choice.key).slice(0, 256),
            title: choice.label.slice(0, 20),
          },
        })),
      },
    }

  return {
    type: 'list',
    body: { text },
    action: {
      button: 'Escolher',
      sections: [
        {
          rows: choices.slice(0, MAX_CHOICES).map((choice) => ({
            id: choicePayload(nodeId, choice.key).slice(0, 200),
            // O título da linha da lista tem teto de 24 caracteres.
            title: choice.label.slice(0, 24),
          })),
        },
      ],
    },
  }
}
