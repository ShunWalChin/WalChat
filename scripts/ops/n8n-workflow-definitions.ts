/** Definições versionadas dos workflows operacionais do Wal Chat no n8n. */
import { createHash } from 'node:crypto'

export const N8N_WORKFLOW_NAMES = {
  gateway: 'Wal Chat | 00 | Event Gateway v2',
  contactUpsert: 'Wal Chat | 10 | Contact Upsert Command v1',
  tagApply: 'Wal Chat | 20 | Tag Apply Command v1',
  automationExecute: 'Wal Chat | 30 | Automation Execute Command v1',
  health: 'Wal Chat | 90 | Production Health v1',
} as const

export const N8N_WEBHOOK_PATHS = {
  gateway: 'wal-chat-events-v1',
  contactUpsert: 'wal-chat-contact-upsert-v1',
  tagApply: 'wal-chat-tag-apply-v1',
  automationExecute: 'wal-chat-automation-execute-v1',
  health: 'wal-chat-health-v1',
} as const

export const LEGACY_GATEWAY_WORKFLOW_NAME = 'Wal Chat — Event Gateway v1'

export type N8nCredentialReference = { id: string; name: string }

export type N8nNodeDefinition = {
  parameters: Record<string, unknown>
  id: string
  name: string
  type: string
  typeVersion: number
  position: [number, number]
  webhookId?: string
  credentials?: { httpHeaderAuth: N8nCredentialReference }
  retryOnFail?: boolean
  maxTries?: number
  waitBetweenTries?: number
}

export type N8nWorkflowDefinition = {
  name: string
  nodes: N8nNodeDefinition[]
  connections: Record<
    string,
    { main: Array<Array<{ node: string; type: 'main'; index: number }>> }
  >
  settings: Record<string, unknown>
}

type DefinitionInput = {
  credential: N8nCredentialReference
  walChatInboundUrl: string
  walChatReadinessUrl: string
  gatewayWebhookId?: string
}

const privateWorkflowSettings = {
  executionOrder: 'v1',
  saveDataErrorExecution: 'none',
  saveDataSuccessExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false,
  timezone: 'America/Sao_Paulo',
}

/**
 * Gera a suíte sem segredos literais. Os nós referenciam somente a Credential
 * Header Auth já existente no n8n; o token continua protegido pelo cofre n8n.
 */
export function buildWalChatN8nWorkflows(
  input: DefinitionInput,
): N8nWorkflowDefinition[] {
  return [
    buildEventGateway(input),
    buildContactUpsert(input),
    buildTagApply(input),
    buildAutomationExecute(input),
    buildProductionHealth(input),
  ]
}

function buildEventGateway(input: DefinitionInput): N8nWorkflowDefinition {
  const receive = webhookNode({
    workflow: 'gateway',
    name: 'Receber eventos do Wal Chat',
    path: N8N_WEBHOOK_PATHS.gateway,
    credential: input.credential,
    webhookId: input.gatewayWebhookId,
  })
  const validate = codeNode(
    'gateway',
    'Validar, rotear e minimizar dados',
    320,
    String.raw`
const request = $input.first().json;
const envelope = request.body ?? request;
const allowed = new Set([
  'contact.created',
  'contact.updated',
  'message.received',
  'booking.created',
  'automation.completed',
  'automation.node',
  'integration.test',
]);

if (envelope.schemaVersion !== 1) throw new Error('schemaVersion não suportada.');
if (!allowed.has(envelope.eventType)) throw new Error('eventType não suportado.');
if (typeof envelope.deliveryId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(envelope.deliveryId)) {
  throw new Error('deliveryId inválido.');
}
if (!envelope.workspace || typeof envelope.workspace.id !== 'string') {
  throw new Error('workspace inválido.');
}
if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
  throw new Error('data inválido.');
}

const data = envelope.data;
let route = 'diagnostics';
let summary = {};
switch (envelope.eventType) {
  case 'contact.created':
  case 'contact.updated':
    route = 'contacts';
    summary = {
      contactId: data.contactId ?? null,
      platform: data.platform ?? null,
      lifecycleStage: data.lifecycleStage ?? null,
      hasEmail: typeof data.email === 'string' && data.email.length > 0,
      hasPhone: typeof data.phone === 'string' && data.phone.length > 0,
    };
    break;
  case 'message.received':
    route = 'messages';
    summary = {
      messageId: data.messageId ?? null,
      contactId: data.contactId ?? null,
      conversationId: data.conversationId ?? null,
      platform: data.platform ?? null,
      bodyLength: typeof data.body === 'string' ? data.body.length : 0,
      hasMedia: typeof data.mediaUrl === 'string' && data.mediaUrl.length > 0,
    };
    break;
  case 'booking.created':
    route = 'bookings';
    summary = {
      bookingId: data.bookingId ?? null,
      contactId: data.contactId ?? null,
      startAt: data.startAt ?? null,
      endAt: data.endAt ?? null,
      status: data.status ?? null,
      source: data.source ?? null,
    };
    break;
  case 'automation.completed':
  case 'automation.node':
    route = 'automations';
    summary = {
      executionId: data.executionId ?? null,
      flowId: data.flowId ?? null,
      contactId: data.contactId ?? null,
      nodeId: data.nodeId ?? null,
      platform: data.platform ?? null,
    };
    break;
}

return [{
  json: {
    ok: true,
    accepted: true,
    schemaVersion: 1,
    eventType: envelope.eventType,
    route,
    deliveryId: envelope.deliveryId,
    occurredAt: envelope.occurredAt ?? null,
    workspaceId: envelope.workspace.id,
    summary,
    processedAt: new Date().toISOString(),
  },
}];
`,
  )
  const accepted = noOpNode('gateway', 'Evento aceito', 640)

  return workflow(
    N8N_WORKFLOW_NAMES.gateway,
    [receive, validate, accepted],
    chain(receive.name, validate.name, accepted.name),
  )
}

function buildContactUpsert(input: DefinitionInput): N8nWorkflowDefinition {
  const receive = webhookNode({
    workflow: 'contact-upsert',
    name: 'Receber comando de contato',
    path: N8N_WEBHOOK_PATHS.contactUpsert,
    credential: input.credential,
  })
  const validate = codeNode(
    'contact-upsert',
    'Validar e normalizar contato',
    320,
    String.raw`
const request = $input.first().json;
const input = request.body ?? request;
const data = input.data ?? input;
const headers = request.headers ?? {};
const deliveryId = String(headers['x-walchat-delivery-id'] ?? input.deliveryId ?? '');
const text = (name, value, min, max, required = false) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(name + ' é obrigatório.');
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(name + ' deve ser texto.');
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(name + ' fora do limite.');
  return normalized;
};
if (!/^[A-Za-z0-9._:-]{8,128}$/.test(deliveryId)) throw new Error('deliveryId inválido.');

const normalized = { externalId: text('externalId', data.externalId, 1, 160, true) };
for (const [key, min, max] of [
  ['fullName', 1, 160], ['email', 3, 254], ['phone', 7, 32],
  ['company', 1, 120], ['jobTitle', 1, 120],
]) {
  const value = text(key, data[key], min, max);
  if (value !== undefined) normalized[key] = value;
}
if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) throw new Error('email inválido.');
if (data.lifecycleStage !== undefined) {
  if (!['lead', 'engaged', 'customer', 'vip', 'inactive'].includes(data.lifecycleStage)) throw new Error('lifecycleStage inválido.');
  normalized.lifecycleStage = data.lifecycleStage;
}
if (data.leadScore !== undefined) {
  if (!Number.isInteger(data.leadScore) || data.leadScore < 0 || data.leadScore > 100) throw new Error('leadScore inválido.');
  normalized.leadScore = data.leadScore;
}
if (data.marketingConsent !== undefined) {
  if (!['unknown', 'granted', 'revoked'].includes(data.marketingConsent)) throw new Error('marketingConsent inválido.');
  normalized.marketingConsent = data.marketingConsent;
}
if (data.customFields !== undefined) {
  if (!data.customFields || typeof data.customFields !== 'object' || Array.isArray(data.customFields)) throw new Error('customFields inválido.');
  const entries = Object.entries(data.customFields);
  if (entries.length > 50 || entries.some(([key]) => key.length > 64 || ['__proto__', 'constructor', 'prototype'].includes(key))) {
    throw new Error('customFields excede os limites.');
  }
  normalized.customFields = Object.fromEntries(entries);
}

return [{ json: { deliveryId, command: { schemaVersion: 1, eventType: 'contact.upsert', data: normalized } } }];
`,
  )
  const dispatch = walChatCommandNode(
    'contact-upsert',
    'Criar ou atualizar contato no Wal Chat',
    input.walChatInboundUrl,
    input.credential,
  )
  return workflow(
    N8N_WORKFLOW_NAMES.contactUpsert,
    [receive, validate, dispatch],
    chain(receive.name, validate.name, dispatch.name),
  )
}

function buildTagApply(input: DefinitionInput): N8nWorkflowDefinition {
  const receive = webhookNode({
    workflow: 'tag-apply',
    name: 'Receber comando de tag',
    path: N8N_WEBHOOK_PATHS.tagApply,
    credential: input.credential,
  })
  const validate = codeNode(
    'tag-apply',
    'Validar e normalizar tag',
    320,
    String.raw`
const request = $input.first().json;
const input = request.body ?? request;
const data = input.data ?? input;
const headers = request.headers ?? {};
const deliveryId = String(headers['x-walchat-delivery-id'] ?? input.deliveryId ?? '');
if (!/^[A-Za-z0-9._:-]{8,128}$/.test(deliveryId)) throw new Error('deliveryId inválido.');
const externalId = typeof data.externalId === 'string' ? data.externalId.trim() : '';
const tagName = typeof data.tagName === 'string' ? data.tagName.trim() : '';
const tagColor = data.tagColor ?? '#111111';
if (!externalId || externalId.length > 160) throw new Error('externalId inválido.');
if (!tagName || tagName.length > 40) throw new Error('tagName inválido.');
if (typeof tagColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(tagColor)) throw new Error('tagColor inválida.');
return [{
  json: {
    deliveryId,
    command: {
      schemaVersion: 1,
      eventType: 'contact.tag.apply',
      data: { externalId, tagName, tagColor },
    },
  },
}];
`,
  )
  const dispatch = walChatCommandNode(
    'tag-apply',
    'Aplicar tag no Wal Chat',
    input.walChatInboundUrl,
    input.credential,
  )
  return workflow(
    N8N_WORKFLOW_NAMES.tagApply,
    [receive, validate, dispatch],
    chain(receive.name, validate.name, dispatch.name),
  )
}

function buildAutomationExecute(input: DefinitionInput): N8nWorkflowDefinition {
  const receive = webhookNode({
    workflow: 'automation-execute',
    name: 'Receber comando de automação',
    path: N8N_WEBHOOK_PATHS.automationExecute,
    credential: input.credential,
  })
  const validate = codeNode(
    'automation-execute',
    'Validar automação e contexto',
    320,
    String.raw`
const request = $input.first().json;
const input = request.body ?? request;
const data = input.data ?? input;
const headers = request.headers ?? {};
const deliveryId = String(headers['x-walchat-delivery-id'] ?? input.deliveryId ?? '');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!/^[A-Za-z0-9._:-]{8,128}$/.test(deliveryId)) throw new Error('deliveryId inválido.');
if (typeof data.contactId !== 'string' || !uuid.test(data.contactId)) throw new Error('contactId inválido.');
if (typeof data.flowId !== 'string' || !uuid.test(data.flowId)) throw new Error('flowId inválido.');
if (!['instagram', 'whatsapp'].includes(data.platform)) throw new Error('platform inválida.');
const context = data.context ?? {};
if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error('context inválido.');
const entries = Object.entries(context);
if (entries.length > 50 || entries.some(([key]) => key.length > 80 || ['__proto__', 'constructor', 'prototype'].includes(key))) {
  throw new Error('context excede os limites.');
}
return [{
  json: {
    deliveryId,
    command: {
      schemaVersion: 1,
      eventType: 'automation.execute',
      data: {
        contactId: data.contactId,
        flowId: data.flowId,
        platform: data.platform,
        context: Object.fromEntries(entries),
      },
    },
  },
}];
`,
  )
  const dispatch = walChatCommandNode(
    'automation-execute',
    'Executar automação pelo gateway seguro',
    input.walChatInboundUrl,
    input.credential,
  )
  return workflow(
    N8N_WORKFLOW_NAMES.automationExecute,
    [receive, validate, dispatch],
    chain(receive.name, validate.name, dispatch.name),
  )
}

function buildProductionHealth(input: DefinitionInput): N8nWorkflowDefinition {
  const schedule: N8nNodeDefinition = {
    parameters: {
      rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] },
    },
    id: stableId('health:schedule'),
    name: 'A cada 5 minutos',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [0, -120],
  }
  const manual = webhookNode({
    workflow: 'health',
    name: 'Executar diagnóstico autenticado',
    path: N8N_WEBHOOK_PATHS.health,
    credential: input.credential,
    position: [0, 120],
  })
  const check: N8nNodeDefinition = {
    parameters: {
      url: input.walChatReadinessUrl,
      options: { timeout: 8000 },
    },
    id: stableId('health:http'),
    name: 'Consultar readiness do Wal Chat',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [340, 0],
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
  }
  const assert = codeNode(
    'health',
    'Confirmar saúde de produção',
    680,
    String.raw`
const readiness = $input.first().json;
if (readiness.ok !== true) throw new Error('Wal Chat não está ready.');
return [{
  json: {
    ok: true,
    service: 'wal-chat',
    status: 'ready',
    checkedAt: new Date().toISOString(),
    dependencies: readiness.dependencies ?? {},
  },
}];
`,
  )

  const definition = workflow(
    N8N_WORKFLOW_NAMES.health,
    [schedule, manual, check, assert],
    {
      [schedule.name]: {
        main: [[{ node: check.name, type: 'main', index: 0 }]],
      },
      [manual.name]: {
        main: [[{ node: check.name, type: 'main', index: 0 }]],
      },
      [check.name]: {
        main: [[{ node: assert.name, type: 'main', index: 0 }]],
      },
    },
  )
  // Readiness não contém PII; manter histórico facilita SLO e incidentes.
  definition.settings.saveDataSuccessExecution = 'all'
  definition.settings.saveDataErrorExecution = 'all'
  return definition
}

function workflow(
  name: string,
  nodes: N8nNodeDefinition[],
  connections: N8nWorkflowDefinition['connections'],
): N8nWorkflowDefinition {
  return {
    name,
    nodes,
    connections,
    settings: { ...privateWorkflowSettings },
  }
}

function webhookNode(input: {
  workflow: string
  name: string
  path: string
  credential: N8nCredentialReference
  webhookId?: string
  position?: [number, number]
}): N8nNodeDefinition {
  return {
    parameters: {
      authentication: 'headerAuth',
      httpMethod: 'POST',
      path: input.path,
      responseMode: 'lastNode',
      options: {},
    },
    id: stableId(`${input.workflow}:webhook`),
    name: input.name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: input.position ?? [0, 0],
    webhookId: input.webhookId ?? stableId(`${input.workflow}:webhook-id`),
    credentials: { httpHeaderAuth: input.credential },
  }
}

function codeNode(
  workflowName: string,
  name: string,
  x: number,
  jsCode: string,
): N8nNodeDefinition {
  return {
    parameters: { jsCode: jsCode.trim() },
    id: stableId(`${workflowName}:${name}`),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [x, 0],
  }
}

function noOpNode(
  workflowName: string,
  name: string,
  x: number,
): N8nNodeDefinition {
  return {
    parameters: {},
    id: stableId(`${workflowName}:${name}`),
    name,
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [x, 0],
  }
}

function walChatCommandNode(
  workflowName: string,
  name: string,
  url: string,
  credential: N8nCredentialReference,
): N8nNodeDefinition {
  return {
    parameters: {
      method: 'POST',
      url,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'X-WalChat-Delivery-Id',
            value: '={{ $json.deliveryId }}',
          },
          {
            name: 'X-WalChat-Timestamp',
            value: '={{ Math.floor(Date.now() / 1000).toString() }}',
          },
        ],
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: '={{ JSON.stringify($json.command) }}',
      options: { timeout: 8000 },
    },
    id: stableId(`${workflowName}:http`),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [680, 0],
    credentials: { httpHeaderAuth: credential },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
  }
}

function chain(...nodeNames: string[]): N8nWorkflowDefinition['connections'] {
  return Object.fromEntries(
    nodeNames.slice(0, -1).map((name, index) => [
      name,
      {
        main: [
          [{ node: nodeNames[index + 1], type: 'main' as const, index: 0 }],
        ],
      },
    ]),
  )
}

/** UUID determinístico mantém IDs e webhooks estáveis em provisionamentos. */
function stableId(value: string) {
  const bytes = createHash('sha256')
    .update(`wal-chat:${value}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
