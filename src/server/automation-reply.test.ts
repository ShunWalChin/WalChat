/**
 * Cobre a retomada por resposta do contato.
 *
 * O motor precisa de Supabase, então este arquivo traz um cliente falso que
 * grava o que foi pedido. Não é elegante, mas é a única forma de exercitar o
 * caminho de tentativas sem um banco de verdade — e é exatamente onde dois bugs
 * moravam.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { resumeAutomationAfterReply } from './automation-engine.server'
import type { AutomationGraph } from './automation-graph'

const PERGUNTA_EMAIL: AutomationGraph = {
  schemaVersion: 3,
  entryNodeId: 'start',
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'email',
      type: 'user_input',
      config: {
        prompt: 'Qual seu e-mail?',
        expects: 'email',
        save: { target: 'custom', fieldKey: 'email_lead' },
        maxAttempts: 2,
        timeoutSeconds: 86_400,
      },
    },
    { id: 'ok', type: 'message', config: { text: 'Anotado!' } },
    { id: 'desiste', type: 'message', config: { text: 'Sem problema.' } },
    { id: 'fim', type: 'end' },
  ],
  edges: [
    { from: 'start', to: 'email', branch: 'default' },
    { from: 'email', to: 'ok', branch: 'default' },
    { from: 'email', to: 'desiste', branch: 'invalid' },
    { from: 'ok', to: 'fim', branch: 'default' },
    { from: 'desiste', to: 'fim', branch: 'default' },
  ],
}

type Registro = {
  jobs: Array<Record<string, unknown>>
  updatesDaExecucao: Array<Record<string, unknown>>
  updatesDeContato: Array<Record<string, unknown>>
}

/** Estado da execução entre chamadas, como o banco faria. */
let execucao: Record<string, unknown>
let registro: Registro

/** Cliente falso: só o suficiente para as cadeias que o motor usa. */
function clienteFalso() {
  const construtor = (tabela: string) => {
    const estado: { linhas: unknown; payload?: Record<string, unknown> } = {
      linhas: null,
    }
    const encadeavel: Record<string, unknown> = {}
    const devolve = () => encadeavel
    for (const metodo of ['select', 'eq', 'order', 'limit', 'not', 'in'])
      encadeavel[metodo] = devolve
    encadeavel.maybeSingle = async () => ({
      data: tabela === 'automation_executions' ? execucao : estado.linhas,
      error: null,
    })
    encadeavel.single = async () => {
      if (tabela === 'automation_flow_versions')
        return { data: { graph: PERGUNTA_EMAIL }, error: null }
      if (tabela === 'scheduled_jobs')
        return { data: { id: 'job_' + registro.jobs.length }, error: null }
      if (tabela === 'contacts')
        return { data: { custom_fields: {} }, error: null }
      return { data: estado.linhas, error: null }
    }
    encadeavel.upsert = (payload: Record<string, unknown>) => {
      if (tabela === 'scheduled_jobs') registro.jobs.push(payload)
      return encadeavel
    }
    encadeavel.update = (payload: Record<string, unknown>) => {
      if (tabela === 'automation_executions') {
        registro.updatesDaExecucao.push(payload)
        // O banco persistiria; o motor lê este estado na próxima chamada.
        Object.assign(execucao, payload)
      }
      if (tabela === 'contacts') registro.updatesDeContato.push(payload)
      return encadeavel
    }
    return encadeavel
  }
  return { from: construtor } as never
}

function reiniciar() {
  execucao = {
    id: 'exec_1',
    workspace_id: 'ws_1',
    flow_version_id: 'v_1',
    contact_id: 'contato_1',
    platform: 'instagram',
    context: {},
    status: 'waiting_reply',
    awaiting_kind: 'input',
    awaiting_node_id: 'email',
    awaiting_attempts: 0,
  }
  registro = { jobs: [], updatesDaExecucao: [], updatesDeContato: [] }
}

async function responder(texto: string) {
  return resumeAutomationAfterReply(
    { workspaceId: 'ws_1', contactId: 'contato_1', text: texto },
    clienteFalso(),
  )
}

beforeEach(reiniciar)

describe('resposta válida', () => {
  it('salva o valor e segue pela saída de sucesso', async () => {
    const r = await responder('ana@exemplo.com.br')
    expect(r).toMatchObject({ handled: true, branch: 'default' })
    expect(registro.updatesDeContato[0]).toMatchObject({
      custom_fields: { email_lead: 'ana@exemplo.com.br' },
    })
  })

  it('limpa o estado de espera ao avançar', async () => {
    await responder('ana@exemplo.com.br')
    const ultimo = registro.updatesDaExecucao.at(-1)
    expect(ultimo).toMatchObject({
      status: 'scheduled',
      awaiting_node_id: null,
      awaiting_attempts: 0,
    })
  })
})

describe('resposta inválida', () => {
  it('conta a tentativa e continua esperando', async () => {
    const r = await responder('não tenho')
    expect(r).toMatchObject({ handled: true, retried: true })
    expect(execucao.awaiting_attempts).toBe(1)
  })

  it('agenda a mensagem de orientação com chave própria', async () => {
    await responder('não tenho')
    const job = registro.jobs.at(-1)
    expect(job).toBeDefined()
    // Reusar a chave do prompt original faria o upsert cair na linha já
    // concluída, e a orientação nunca sairia — o contato ficaria sem resposta.
    expect(job?.dedupe_key).not.toBe('flow:exec_1:message:email')
  })

  it('reabre o job para o scheduler poder reivindicá-lo', async () => {
    await responder('não tenho')
    // `claim_due_scheduled_jobs` só enxerga status 'pending'.
    expect(registro.jobs.at(-1)?.status).toBe('pending')
  })

  it('esgota as tentativas e sai pela saída invalid', async () => {
    await responder('não tenho')
    expect(execucao.awaiting_attempts).toBe(1)

    const segunda = await responder('continuo sem ter')
    expect(segunda).toMatchObject({ handled: true, branch: 'invalid' })
  })

  it('sai do fluxo em duas tentativas e não volta a perguntar', async () => {
    const respostas = []
    for (let i = 0; i < 4; i++) respostas.push(await responder('ruim ' + i))
    // Duas tentativas, saída por `invalid`, e depois nada mais esperando: a
    // pergunta não pode se repetir para sempre.
    expect(respostas[0]).toMatchObject({ retried: true })
    expect(respostas[1]).toMatchObject({ branch: 'invalid' })
    expect(respostas[2]).toMatchObject({ handled: false })
  })

  it('preserva a tentativa quando a orientação é reenviada', async () => {
    // O estacionamento acontece depois que a mensagem sai; se ele zerasse o
    // contador, `maxAttempts` nunca seria alcançado.
    await responder('não tenho')
    const job = registro.jobs.at(-1)
    const payload = job?.payload as { flowAwait?: { attempts?: number } }
    expect(payload.flowAwait?.attempts).toBe(1)
  })
})

describe('mensagem que não é para o fluxo', () => {
  it('devolve handled:false quando não há execução esperando', async () => {
    execucao = { ...execucao, status: 'completed', awaiting_node_id: null }
    const r = await responder('oi')
    expect(r).toMatchObject({ handled: false })
  })
})
