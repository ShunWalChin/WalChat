/**
 * Boas-vindas ao primeiro contato: regras puras, sem rede nem banco.
 *
 * Por que não é "novo seguidor": a Instagram API não entrega evento de follow, e
 * a política de mensageria só abre a janela de 24h quando o contato escreve
 * primeiro. Um seguidor que nunca falou não pode receber DM — a plataforma
 * recusa, e insistir arrisca a conta. O evento acionável equivalente é a
 * primeira interação da pessoa, que é o que este módulo modela.
 *
 * As mensagens viram um DAG normal em vez de um motor novo. Assim o compliance,
 * a idempotência e o versionamento vêm de graça, e o operador pode abrir o
 * mesmo fluxo no Studio depois e ramificá-lo.
 */
import { z } from 'zod'
import type { AutomationGraph } from './automation-graph'

/** Canais que podem contar como primeiro contato. */
export const WELCOME_CHANNELS = [
  'dm',
  'comment',
  'story_reply',
  'mention',
] as const

export type WelcomeChannel = (typeof WELCOME_CHANNELS)[number]

/** Teto de mensagens da saudação. Acima disso vira sequência, não boas-vindas. */
export const MAX_WELCOME_MESSAGES = 4

const welcomeMessageSchema = z
  .object({
    text: z.string().trim().min(1).max(1_000),
    /**
     * Espera antes desta mensagem. A primeira sai na hora; as demais respeitam
     * o intervalo para a saudação não chegar como rajada.
     */
    delaySeconds: z.number().int().min(0).max(86_400).default(0),
    mediaUrl: z
      .url()
      .max(2_048)
      .refine((value) => value.startsWith('https://'), 'Use HTTPS.')
      .nullable()
      .optional(),
  })
  .strict()

export const welcomeSettingsSchema = z
  .object({
    isActive: z.boolean().default(false),
    channels: z.array(z.enum(WELCOME_CHANNELS)).min(1).max(4).default(['dm']),
    /** Impede repetir a saudação para quem já foi saudado. */
    cooldownHours: z.number().int().min(1).max(168).default(168),
    messages: z.array(welcomeMessageSchema).min(1).max(MAX_WELCOME_MESSAGES),
  })
  .strict()

export type WelcomeSettings = z.infer<typeof welcomeSettingsSchema>
export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>

/**
 * Decide se esta interação é o primeiro contato da pessoa.
 *
 * `previousInboundCount` conta as interações recebidas ANTES desta. Zero
 * significa que a pessoa está chegando agora. A contagem exclui a interação
 * atual de propósito: incluí-la faria todo contato parecer veterano.
 */
export function isFirstContact(input: {
  previousInboundCount: number
  channel: string
  enabledChannels: Array<string>
}) {
  if (input.previousInboundCount > 0) return false
  return input.enabledChannels.includes(input.channel)
}

/**
 * Converte a saudação em um DAG linear.
 *
 * Uma espera com zero segundos não vira bloco: o motor exige no mínimo um
 * segundo em `delay`, e um bloco inútil só polui a trilha de execução.
 */
export function buildWelcomeGraph(settings: WelcomeSettings): AutomationGraph {
  const nodes: AutomationGraph['nodes'] = [{ id: 'start', type: 'start' }]
  const edges: AutomationGraph['edges'] = []
  let anterior = 'start'

  settings.messages.forEach((message, index) => {
    if (index > 0 && message.delaySeconds >= 1) {
      const esperaId = `espera_${index}`
      nodes.push({
        id: esperaId,
        type: 'delay',
        config: { seconds: message.delaySeconds },
      })
      edges.push({ from: anterior, to: esperaId, branch: 'default' })
      anterior = esperaId
    }
    const mensagemId = `msg_${index}`
    nodes.push({
      id: mensagemId,
      type: 'message',
      config: {
        text: message.text,
        ...(message.mediaUrl
          ? { mediaUrl: message.mediaUrl, mediaType: 'image' as const }
          : {}),
      },
    })
    edges.push({ from: anterior, to: mensagemId, branch: 'default' })
    anterior = mensagemId
  })

  nodes.push({ id: 'fim', type: 'end', config: { outcome: 'welcomed' } })
  edges.push({ from: anterior, to: 'fim', branch: 'default' })

  return { schemaVersion: 3, entryNodeId: 'start', nodes, edges }
}

/**
 * Traduz o DAG de volta para a saudação editável.
 *
 * A tela precisa reabrir o que gravou. Sem esta volta, editar a saudação
 * exigiria começar do zero toda vez.
 */
export function readWelcomeGraph(
  graph: AutomationGraph,
): Array<WelcomeMessage> {
  const mensagens: Array<WelcomeMessage> = []
  let esperaPendente = 0

  // Percorre pela ordem das arestas, não pela ordem do array: o grafo é a
  // verdade sobre a sequência, e a lista de nós pode vir em qualquer ordem.
  let atual: string | undefined = graph.entryNodeId
  const visitados = new Set<string>()
  while (atual && !visitados.has(atual)) {
    visitados.add(atual)
    const no = graph.nodes.find((item) => item.id === atual)
    if (!no) break
    if (no.type === 'delay') esperaPendente = no.config.seconds
    if (no.type === 'message') {
      mensagens.push({
        text: no.config.text,
        delaySeconds: esperaPendente,
        mediaUrl: no.config.mediaUrl ?? null,
      })
      esperaPendente = 0
    }
    atual = graph.edges.find(
      (edge) => edge.from === no.id && edge.branch === 'default',
    )?.to
  }
  return mensagens
}

/** Resumo para a tela mostrar sem precisar percorrer o grafo. */
export function summarizeWelcome(settings: WelcomeSettings) {
  const espera = settings.messages.reduce(
    (total, message, index) => total + (index > 0 ? message.delaySeconds : 0),
    0,
  )
  return {
    messages: settings.messages.length,
    totalDelaySeconds: espera,
    channels: settings.channels,
    characters: settings.messages.reduce(
      (total, message) => total + message.text.length,
      0,
    ),
  }
}
