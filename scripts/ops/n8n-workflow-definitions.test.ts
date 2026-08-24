import { describe, expect, it } from 'vitest'
import {
  buildWalChatN8nWorkflows,
  N8N_WEBHOOK_PATHS,
  N8N_WORKFLOW_NAMES,
} from './n8n-workflow-definitions'

const credential = { id: 'credential-id', name: 'Wal Chat Header Auth' }
const workflows = buildWalChatN8nWorkflows({
  credential,
  walChatInboundUrl:
    'https://wal-chat.example.com/api/public/webhooks/n8n/connection-id',
  walChatReadinessUrl: 'https://wal-chat.example.com/api/ready',
})

describe('Wal Chat n8n workflow definitions', () => {
  it('builds the complete, uniquely named suite', () => {
    expect(workflows).toHaveLength(Object.keys(N8N_WORKFLOW_NAMES).length)
    expect(new Set(workflows.map((workflow) => workflow.name)).size).toBe(
      workflows.length,
    )
  })

  it('protects every public webhook with the existing Header Auth credential', () => {
    const webhookNodes = workflows.flatMap((workflow) =>
      workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.webhook'),
    )
    expect(webhookNodes).toHaveLength(Object.keys(N8N_WEBHOOK_PATHS).length)
    for (const node of webhookNodes) {
      expect(node.parameters.authentication).toBe('headerAuth')
      expect(node.credentials?.httpHeaderAuth).toEqual(credential)
    }
    expect(new Set(webhookNodes.map((node) => node.parameters.path)).size).toBe(
      webhookNodes.length,
    )
  })

  it('routes write commands only through the Wal Chat inbound gateway', () => {
    const requestNodes = workflows.flatMap((workflow) =>
      workflow.nodes.filter(
        (node) => node.type === 'n8n-nodes-base.httpRequest',
      ),
    )
    const writeNodes = requestNodes.filter(
      (node) => node.parameters.method === 'POST',
    )
    expect(writeNodes).toHaveLength(3)
    for (const node of writeNodes) {
      expect(node.parameters.url).toBe(
        'https://wal-chat.example.com/api/public/webhooks/n8n/connection-id',
      )
      expect(node.parameters.body).toBe('={{ JSON.stringify($json.command) }}')
      expect(node.retryOnFail).toBe(true)
      expect(node.maxTries).toBe(3)
    }
  })

  it('does not persist business payloads and keeps only health history', () => {
    for (const workflow of workflows) {
      const expected =
        workflow.name === N8N_WORKFLOW_NAMES.health ? 'all' : 'none'
      expect(workflow.settings.saveDataSuccessExecution).toBe(expected)
      expect(workflow.settings.saveDataErrorExecution).toBe(expected)
    }
  })
})
