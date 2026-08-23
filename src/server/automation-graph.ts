/** Contrato puro, versionável e sem `eval` do motor de automações DAG. */
import { z } from 'zod'

const nodeId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/)
const scalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()])

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_tag'), tagId: z.uuid() }).strict(),
  z.object({ type: z.literal('remove_tag'), tagId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('set_custom_field'),
      fieldKey,
      value: scalarValue,
    })
    .strict(),
  z.object({ type: z.literal('clear_custom_field'), fieldKey }).strict(),
  z
    .object({
      type: z.literal('set_bot_field'),
      fieldKey,
      value: scalarValue,
    })
    .strict(),
])

const conditionSchema = z
  .object({
    source: z.enum(['contact', 'custom', 'bot', 'context']),
    field: z.string().trim().min(1).max(80),
    operator: z.enum([
      'equals',
      'does_not_equal',
      'contains',
      'does_not_contain',
      'starts_with',
      'is_set',
      'is_not_set',
      'greater_than',
      'less_than',
      'in_24h_window',
    ]),
    value: scalarValue.optional(),
  })
  .strict()

const automationNodeSchema = z.discriminatedUnion('type', [
  z.object({ id: nodeId, type: z.literal('start') }).strict(),
  z
    .object({
      id: nodeId,
      type: z.literal('message'),
      config: z
        .object({
          text: z.string().trim().min(1).max(1_000),
          bookingPageId: z.uuid().nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: nodeId,
      type: z.literal('action'),
      config: z
        .object({ actions: z.array(actionSchema).min(1).max(10) })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: nodeId,
      type: z.literal('condition'),
      config: conditionSchema,
    })
    .strict(),
  z
    .object({
      id: nodeId,
      type: z.literal('delay'),
      config: z
        .object({ seconds: z.number().int().min(1).max(604_800) })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: nodeId,
      type: z.literal('random_split'),
      config: z
        .object({
          branches: z
            .array(
              z
                .object({
                  key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
                  weight: z.number().int().min(1).max(100),
                })
                .strict(),
            )
            .min(2)
            .max(10),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: nodeId,
      type: z.literal('end'),
      config: z
        .object({ outcome: z.string().trim().min(1).max(80).optional() })
        .strict()
        .optional(),
    })
    .strict(),
])

const automationEdgeSchema = z
  .object({
    from: nodeId,
    to: nodeId,
    branch: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,31}$/)
      .default('default'),
  })
  .strict()

export const automationGraphSchema = z
  .object({
    schemaVersion: z.literal(1),
    entryNodeId: nodeId,
    nodes: z.array(automationNodeSchema).min(2).max(100),
    edges: z.array(automationEdgeSchema).min(1).max(200),
  })
  .strict()

export type AutomationGraph = z.infer<typeof automationGraphSchema>
export type AutomationNode = AutomationGraph['nodes'][number]
export type AutomationAction = z.infer<typeof actionSchema>
export type AutomationCondition = z.infer<typeof conditionSchema>
export type AutomationFieldType =
  'text' | 'number' | 'date' | 'datetime' | 'boolean'

export type AutomationVariables = {
  contact: Record<string, unknown>
  custom: Record<string, unknown>
  bot: Record<string, unknown>
  context: Record<string, unknown>
}

export class AutomationGraphError extends Error {
  constructor(
    readonly code: string,
    readonly node?: string,
  ) {
    super(node ? `${code}:${node}` : code)
    this.name = 'AutomationGraphError'
  }
}

/** Valida topologia, portas, alcançabilidade e aciclicidade antes da publicação. */
export function validateAutomationGraph(input: unknown): AutomationGraph {
  const graph = automationGraphSchema.parse(input)
  const nodes = new Map<string, AutomationNode>()
  for (const node of graph.nodes) {
    if (nodes.has(node.id))
      throw new AutomationGraphError('duplicate_node', node.id)
    nodes.set(node.id, node)
  }
  const entry = nodes.get(graph.entryNodeId)
  if (!entry || entry.type !== 'start')
    throw new AutomationGraphError('entry_must_be_start', graph.entryNodeId)
  if (graph.nodes.filter((node) => node.type === 'start').length !== 1)
    throw new AutomationGraphError('single_start_required')

  const outgoing = new Map<string, Map<string, string>>()
  const adjacency = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from))
      throw new AutomationGraphError('edge_source_missing', edge.from)
    if (!nodes.has(edge.to))
      throw new AutomationGraphError('edge_target_missing', edge.to)
    const ports = outgoing.get(edge.from) ?? new Map<string, string>()
    if (ports.has(edge.branch))
      throw new AutomationGraphError('duplicate_branch', edge.from)
    ports.set(edge.branch, edge.to)
    outgoing.set(edge.from, ports)
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to])
  }

  for (const node of graph.nodes) {
    const branches = new Set(outgoing.get(node.id)?.keys() ?? [])
    if (node.type === 'end') {
      if (branches.size)
        throw new AutomationGraphError('end_has_outgoing_edge', node.id)
      continue
    }
    const expected =
      node.type === 'condition'
        ? new Set(['true', 'false'])
        : node.type === 'random_split'
          ? new Set(node.config.branches.map((branch) => branch.key))
          : new Set(['default'])
    if (!sameSet(branches, expected))
      throw new AutomationGraphError('invalid_node_branches', node.id)
    if (
      node.type === 'random_split' &&
      node.config.branches.reduce((sum, branch) => sum + branch.weight, 0) !==
        100
    )
      throw new AutomationGraphError('random_weights_must_total_100', node.id)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (id: string) => {
    if (visiting.has(id)) throw new AutomationGraphError('cycle_detected', id)
    if (visited.has(id)) return
    visiting.add(id)
    for (const next of adjacency.get(id) ?? []) walk(next)
    visiting.delete(id)
    visited.add(id)
  }
  walk(graph.entryNodeId)
  const unreachable = graph.nodes.find((node) => !visited.has(node.id))
  if (unreachable)
    throw new AutomationGraphError('unreachable_node', unreachable.id)
  return graph
}

export function automationNode(graph: AutomationGraph, id: string) {
  const node = graph.nodes.find((candidate) => candidate.id === id)
  if (!node) throw new AutomationGraphError('node_missing', id)
  return node
}

export function automationNextNode(
  graph: AutomationGraph,
  from: string,
  branch = 'default',
) {
  const edge = graph.edges.find(
    (candidate) => candidate.from === from && candidate.branch === branch,
  )
  if (!edge) throw new AutomationGraphError('next_edge_missing', from)
  return edge.to
}

export function evaluateAutomationCondition(
  condition: AutomationCondition,
  variables: AutomationVariables,
  now = new Date(),
) {
  const actual = variables[condition.source][condition.field]
  const expected = condition.value
  switch (condition.operator) {
    case 'is_set':
      return actual !== null && actual !== undefined && actual !== ''
    case 'is_not_set':
      return actual === null || actual === undefined || actual === ''
    case 'equals':
      return comparable(actual) === comparable(expected)
    case 'does_not_equal':
      return comparable(actual) !== comparable(expected)
    case 'contains':
      return normalized(actual).includes(normalized(expected))
    case 'does_not_contain':
      return !normalized(actual).includes(normalized(expected))
    case 'starts_with':
      return normalized(actual).startsWith(normalized(expected))
    case 'greater_than':
      return numeric(actual) > numeric(expected)
    case 'less_than':
      return numeric(actual) < numeric(expected)
    case 'in_24h_window': {
      const timestamp = new Date(String(actual ?? '')).getTime()
      return (
        Number.isFinite(timestamp) && now.getTime() - timestamp <= 86_400_000
      )
    }
  }
}

/** Escolha reproduzível: retries do mesmo nó nunca mudam o ramo de A/B. */
export function selectAutomationBranch(
  node: Extract<AutomationNode, { type: 'random_split' }>,
  seed: string,
) {
  let hash = 2_166_136_261
  for (const character of seed) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  const bucket = hash % 100
  let cursor = 0
  for (const branch of node.config.branches) {
    cursor += branch.weight
    if (bucket < cursor) return branch.key
  }
  return node.config.branches.at(-1)!.key
}

/** Interpolação limitada a namespaces conhecidos; nenhuma expressão é executada. */
export function renderAutomationTemplate(
  template: string,
  variables: AutomationVariables,
) {
  return template
    .replace(
      /{{\s*(contact|custom|bot|context)\.([A-Za-z0-9_]+)\s*}}/g,
      (_match, namespace: keyof AutomationVariables, key: string) => {
        const value = variables[namespace][key]
        return value === null || value === undefined ? '' : String(value)
      },
    )
    .slice(0, 1_000)
}

export function defaultAutomationGraph(): AutomationGraph {
  return {
    schemaVersion: 1,
    entryNodeId: 'start',
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'end', type: 'end', config: { outcome: 'completed' } },
    ],
    edges: [{ from: 'start', to: 'end', branch: 'default' }],
  }
}

/** Espelha a validação PostgreSQL para rejeitar valores inválidos na publicação. */
export function isAutomationFieldValue(
  type: AutomationFieldType | string,
  value: unknown,
) {
  if (value === null) return true
  if (type === 'text') return typeof value === 'string' && value.length <= 4_000
  if (type === 'number')
    return typeof value === 'number' && Number.isFinite(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'date')
    return (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    )
  if (type === 'datetime')
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
  return false
}

function sameSet(left: Set<string>, right: Set<string>) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  )
}

function normalized(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('pt-BR')
}

function comparable(value: unknown) {
  return typeof value === 'string' ? normalized(value) : value
}

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
