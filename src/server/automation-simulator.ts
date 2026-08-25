/**
 * Percorre um fluxo sem tocar em nada de fora.
 *
 * Antes disto, a única forma de conferir uma jornada era publicá-la e escolher
 * um contato real — ou seja, testar em produção, em cima de alguém. O simulador
 * usa exatamente as mesmas funções do motor para condição, sorteio, template e
 * validação de resposta, então o que ele mostra é o que vai acontecer.
 *
 * Puro de propósito: sem rede, sem banco e sem relógio. O que seria enviado é
 * descrito, nunca enviado; o que seria chamado é descrito, nunca chamado.
 */
import type {
  AutomationGraph,
  AutomationNode,
  AutomationVariables,
} from './automation-graph'
import {
  automationNextNode,
  automationNode,
  evaluateAutomationCondition,
  renderAutomationTemplate,
  selectAutomationBranch,
} from './automation-graph'
import { matchChoice } from './channel-choices'
import { withOptOut } from './compliance'
import { validateUserInput } from './user-input'

/** Cada passo percorrido, na ordem em que aconteceria. */
export type SimulationStep = {
  nodeId: string
  nodeType: AutomationNode['type']
  /** Frase curta em PT-BR descrevendo o que o passo faz. */
  summary: string
  /** Texto exato que o contato receberia, quando houver mensagem. */
  outgoing?: string
  choices?: Array<{ key: string; label: string }>
  branch?: string
  /** Resposta simulada consumida por este passo. */
  reply?: string
  warning?: string
}

export type SimulationResult = {
  steps: Array<SimulationStep>
  /** Como a simulação terminou. */
  status: 'completed' | 'awaiting_reply' | 'step_limit' | 'error'
  /** Presente quando a simulação parou esperando uma resposta que não veio. */
  awaitingNodeId?: string
  error?: string
  /** Respostas simuladas que sobraram sem ninguém para consumir. */
  unusedReplies: number
}

/** Teto de passos: um fluxo com ciclo já é recusado, mas o limite protege a UI. */
const MAX_STEPS = 60

export type SimulationInput = {
  graph: AutomationGraph
  variables: AutomationVariables
  /** Respostas que o contato fictício daria, na ordem em que forem pedidas. */
  replies?: Array<string>
  /** Semente do sorteio A/B; fixá-la torna a simulação reproduzível. */
  seed?: string
}

export function simulateAutomation(input: SimulationInput): SimulationResult {
  const steps: Array<SimulationStep> = []
  const replies = [...(input.replies ?? [])]
  const seed = input.seed ?? 'simulacao'
  let nodeId = input.graph.entryNodeId

  const finish = (
    status: SimulationResult['status'],
    extra: Partial<SimulationResult> = {},
  ): SimulationResult => ({
    steps,
    status,
    unusedReplies: replies.length,
    ...extra,
  })

  for (let guard = 0; guard < MAX_STEPS; guard++) {
    let node: AutomationNode
    try {
      node = automationNode(input.graph, nodeId)
    } catch {
      return finish('error', { error: `Bloco ${nodeId} não existe no fluxo.` })
    }

    if (node.type === 'end') {
      steps.push({
        nodeId: node.id,
        nodeType: node.type,
        summary: `Jornada encerrada (${node.config?.outcome ?? 'completed'}).`,
      })
      return finish('completed')
    }

    const step = runStep(node, input, replies, seed, steps.length)
    steps.push(step.record)
    if (step.halt)
      return finish(step.halt, {
        ...(step.halt === 'awaiting_reply' ? { awaitingNodeId: node.id } : {}),
        ...(step.error ? { error: step.error } : {}),
      })

    try {
      nodeId = automationNextNode(input.graph, node.id, step.branch)
    } catch {
      return finish('error', {
        error: `O bloco "${describeNode(node)}" não tem saída para "${step.branch}".`,
      })
    }
  }

  return finish('step_limit')
}

type StepOutcome = {
  record: SimulationStep
  branch: string
  halt?: 'awaiting_reply' | 'error'
  error?: string
}

function runStep(
  node: AutomationNode,
  input: SimulationInput,
  replies: Array<string>,
  seed: string,
  index: number,
): StepOutcome {
  const base = { nodeId: node.id, nodeType: node.type }

  switch (node.type) {
    case 'start':
      return {
        record: { ...base, summary: 'Gatilho dispara a jornada.' },
        branch: 'default',
      }

    case 'message': {
      // O rodapé de opt-out é obrigatório em mensagem automática; mostrá-lo
      // aqui evita a surpresa de ver um texto diferente do que foi escrito.
      const outgoing = withOptOut(
        renderAutomationTemplate(node.config.text, input.variables),
      )
      const choices = node.config.choices
      if (!choices?.length)
        return {
          record: { ...base, summary: 'Envia a mensagem.', outgoing },
          branch: 'default',
        }

      const reply = replies.shift()
      if (reply === undefined)
        return {
          record: {
            ...base,
            summary: 'Envia os botões e espera a resposta.',
            outgoing,
            choices,
          },
          branch: 'default',
          halt: 'awaiting_reply',
        }

      const key = matchChoice(choices, { text: reply })
      if (!key)
        return {
          record: {
            ...base,
            summary: 'A resposta não corresponde a nenhum botão.',
            outgoing,
            choices,
            reply,
            warning:
              'Na conversa real o fluxo continuaria esperando, e a mensagem seguiria para a Inbox e para os gatilhos.',
          },
          branch: 'default',
          halt: 'awaiting_reply',
        }

      return {
        record: {
          ...base,
          summary: `Contato escolheu "${choices.find((choice) => choice.key === key)?.label}".`,
          outgoing,
          choices,
          reply,
          branch: key,
        },
        branch: key,
      }
    }

    case 'user_input': {
      const outgoing = withOptOut(
        renderAutomationTemplate(node.config.prompt, input.variables),
      )
      const reply = replies.shift()
      if (reply === undefined)
        return {
          record: {
            ...base,
            summary: 'Pergunta e espera a resposta.',
            outgoing,
          },
          branch: 'default',
          halt: 'awaiting_reply',
        }

      const result = validateUserInput(reply, node.config.expects)
      if (result.valid)
        return {
          record: {
            ...base,
            summary: `Resposta aceita e guardada em ${node.config.save.target}.${node.config.save.fieldKey} como "${result.value}".`,
            outgoing,
            reply,
            branch: 'default',
          },
          branch: 'default',
        }

      return {
        record: {
          ...base,
          summary: `Resposta recusada (${result.reason}).`,
          outgoing,
          reply,
          branch: 'invalid',
          warning: `Na conversa real o contato teria ${node.config.maxAttempts} tentativa(s) antes de sair por "invalid".`,
        },
        branch: 'invalid',
      }
    }

    case 'ai_reply':
      return {
        record: {
          ...base,
          summary: 'O agente de IA geraria a resposta aqui.',
          warning: 'A simulação não chama o provedor de IA.',
        },
        branch: 'default',
      }

    case 'external_request':
      return {
        record: {
          ...base,
          summary: `Chamaria ${node.config.method} ${safeHost(node.config.url)}.`,
          warning: 'A simulação não faz a chamada externa.',
        },
        branch: 'default',
      }

    case 'delay':
      return {
        record: {
          ...base,
          summary: `Esperaria ${describeSeconds(node.config.seconds)}.`,
        },
        branch: 'default',
      }

    case 'condition': {
      const result = evaluateAutomationCondition(node.config, input.variables)
      return {
        record: {
          ...base,
          summary: `${node.config.source}.${node.config.field} ${node.config.operator} → ${result ? 'verdadeiro' : 'falso'}.`,
          branch: result ? 'true' : 'false',
        },
        branch: result ? 'true' : 'false',
      }
    }

    case 'random_split': {
      // A mesma semente do motor: a simulação reproduz o sorteio real.
      const branch = selectAutomationBranch(node, `${seed}:${index}`)
      return {
        record: {
          ...base,
          summary: `Sorteio caiu no ramo ${branch.toUpperCase()}.`,
          branch,
        },
        branch,
      }
    }

    case 'action':
      return {
        record: {
          ...base,
          summary: `${node.config.actions.length} alteração(ões) no CRM.`,
        },
        branch: 'default',
      }

    case 'handoff':
      return {
        record: {
          ...base,
          summary: `Encaminha para a fila ${node.config.category} com prioridade ${node.config.priority}.`,
        },
        branch: 'default',
      }

    case 'n8n_event':
      return {
        record: {
          ...base,
          summary: `Enviaria o evento ${node.config.eventName} ao n8n.`,
          warning: 'A simulação não dispara o evento.',
        },
        branch: 'default',
      }

    case 'subflow':
      return {
        record: {
          ...base,
          summary: 'Entraria em outro fluxo publicado.',
          warning: 'A simulação não percorre o subfluxo.',
        },
        branch: 'default',
      }

    default:
      return {
        record: { ...base, summary: 'Bloco sem simulação definida.' },
        branch: 'default',
      }
  }
}

function describeNode(node: AutomationNode) {
  return node.type === 'message'
    ? node.config.text.slice(0, 40)
    : `${node.type} ${node.id}`
}

/** Mostra só o host: a URL pode carregar identificadores no caminho. */
function safeHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return 'destino inválido'
  }
}

function describeSeconds(seconds: number) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} dia(s)`
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hora(s)`
  return `${Math.round(seconds / 60)} minuto(s)`
}
