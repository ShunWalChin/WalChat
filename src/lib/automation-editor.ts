/**
 * Lógica pura do editor visual de automações.
 *
 * Vive fora do componente porque é onde estão as decisões que quebram um fluxo
 * em silêncio — uma saída órfã depois de renomear um botão, duas escolhas com a
 * mesma chave — e essas decisões merecem teste sem montar a árvore React.
 */
import { nodePorts } from '../server/automation-graph'
import type { AutomationGraph } from '../server/automation-graph'

/**
 * Garante que cada bloco tenha exatamente as saídas que o seu tipo pede.
 *
 * Sem isto, mexer nas escolhas de uma mensagem deixaria uma conexão órfã e
 * outra faltando, e a publicação seria recusada com um erro que o operador não
 * teria como relacionar ao que acabou de fazer. As saídas opcionais já
 * desenhadas — timeout, resposta inválida, erro — são preservadas.
 */
export function reconcileEdges(graph: AutomationGraph): AutomationGraph {
  const fallback =
    graph.nodes.find((node) => node.type === 'end')?.id ?? graph.entryNodeId
  const edges = [...graph.edges]
  for (const node of graph.nodes) {
    const ports = nodePorts(node)
    const current = edges.filter((edge) => edge.from === node.id)
    // Um destino que o bloco já usa é um palpite melhor que o encerramento.
    const target = current.at(0)?.to ?? fallback
    for (const branch of ports.required)
      if (!current.some((edge) => edge.branch === branch))
        edges.push({ from: node.id, to: target, branch })
    for (const edge of current)
      if (!ports.allowed.has(edge.branch)) edges.splice(edges.indexOf(edge), 1)
  }
  return { ...graph, edges }
}

/**
 * Deriva uma chave estável a partir do rótulo que o operador escreveu.
 *
 * O operador escreve só o rótulo do botão. A chave — que vira a saída do bloco
 * e o payload enviado ao canal — sai daqui, porque pedir as duas coisas seria
 * pedir que ele entendesse o mecanismo para escrever uma pergunta.
 */
export function choiceKeyFromLabel(label: string, taken: Array<string>) {
  const base =
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'opcao'
  // O contrato exige que a chave comece por letra.
  const safe = /^[a-z]/.test(base) ? base : `op_${base}`
  if (!taken.includes(safe)) return safe
  // Rótulo repetido é comum ("Sim" duas vezes); a chave precisa continuar única
  // porque é ela que identifica a saída do bloco.
  for (let suffix = 2; suffix < 50; suffix++)
    if (!taken.includes(`${safe}_${suffix}`)) return `${safe}_${suffix}`
  return `${safe}_${taken.length}`
}
