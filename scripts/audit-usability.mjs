/**
 * Auditoria responsiva e semântica das telas autenticadas.
 *
 * Requer uma build local em execução e Chrome/Edge instalado. O script usa o
 * protocolo oficial do navegador, sem dependências de teste adicionais.
 *
 * Exemplo (PowerShell):
 *   $env:WALCHAT_AUDIT_URL='http://127.0.0.1:3002'; npm run audit:usability
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.env.WALCHAT_AUDIT_URL ?? 'http://127.0.0.1:3002'
const ownsAppServer = process.env.WALCHAT_AUDIT_EXTERNAL !== 'true'
const browserCandidates = [
  process.env.WALCHAT_AUDIT_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const browserPath = browserCandidates.find((candidate) => existsSync(candidate))

if (!browserPath) {
  throw new Error(
    'Chrome ou Edge não encontrado. Defina WALCHAT_AUDIT_BROWSER com o executável.',
  )
}

const defaultRoutes = [
  '/dashboard',
  '/operacoes',
  '/inbox',
  '/crm',
  '/radar',
  '/contatos',
  '/respostas',
  '/equipe',
  '/gatilhos',
  '/boas-vindas',
  '/captacao',
  '/comment-to-dm',
  '/sequencias',
  '/agentes',
  '/governanca',
  '/reengajamento',
  '/auto-like',
  '/calendario',
  '/publicar',
  '/insights',
  '/configuracoes',
  '/integracoes',
  '/webhooks',
  '/auditoria',
  '/manual',
]
const routes = process.env.WALCHAT_AUDIT_ROUTES
  ? process.env.WALCHAT_AUDIT_ROUTES.split(',').map((route) => route.trim())
  : defaultRoutes

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'landscape', width: 812, height: 375 },
  { name: 'desktop', width: 1440, height: 900 },
]

const port = 9_320 + Math.floor(Math.random() * 500)
const profilePath = await mkdtemp(join(tmpdir(), 'walchat-ux-'))
let serverOutput = ''
if (ownsAppServer) {
  serverOutput = await runProcess(
    process.execPath,
    [join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
    {
      ...process.env,
      VITE_E2E_MODE: 'true',
      DEMO_MODE: 'true',
      APP_ORIGIN: baseUrl,
    },
  )
}
const appServer = ownsAppServer
  ? spawn(process.execPath, [join(process.cwd(), 'scripts', 'server.mjs')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: new URL(baseUrl).port || '3002',
        DEMO_MODE: 'true',
        APP_ORIGIN: baseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : null
appServer?.stdout.on('data', (chunk) => {
  serverOutput = `${serverOutput}${chunk}`.slice(-8_000)
})
appServer?.stderr.on('data', (chunk) => {
  serverOutput = `${serverOutput}${chunk}`.slice(-8_000)
})
if (appServer) await waitForUrl(`${baseUrl}/api/health`, serverOutput)

const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    `${baseUrl}/`,
  ],
  { stdio: 'ignore' },
)

let socket
let nextId = 0
const pending = new Map()
const runtimeErrors = []
const networkErrors = []
const fixturePipelineId = '10000000-0000-4000-8000-000000000001'
const fixtureStages = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    pipeline_id: fixturePipelineId,
    name: 'Novo lead',
    slug: 'novo',
    description: null,
    position: 1000,
    color: '#3B82F6',
    terminal_state: 'open',
    requires_human: true,
    expected_duration_hours: 24,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    pipeline_id: fixturePipelineId,
    name: 'Qualificação',
    slug: 'qualificacao',
    description: null,
    position: 2000,
    color: '#8B5CF6',
    terminal_state: 'open',
    requires_human: true,
    expected_duration_hours: 48,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    pipeline_id: fixturePipelineId,
    name: 'Ganho',
    slug: 'ganho',
    description: null,
    position: 3000,
    color: '#16A34A',
    terminal_state: 'won',
    requires_human: true,
    expected_duration_hours: 720,
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    pipeline_id: fixturePipelineId,
    name: 'Perdido',
    slug: 'perdido',
    description: null,
    position: 4000,
    color: '#6B7280',
    terminal_state: 'lost',
    requires_human: true,
    expected_duration_hours: 720,
  },
]
let fixtureLeadCounter = 1
let fixtureLeads = [makeFixtureLead('Lead de referência')]

try {
  const target = await waitForTarget(port)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', async (event) => {
    const payload =
      typeof event.data === 'string' ? event.data : await event.data.text()
    const message = JSON.parse(payload)
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(
        message.params?.exceptionDetails?.exception?.description ??
          message.params?.exceptionDetails?.text ??
          'Erro sem descrição',
      )
      return
    }
    if (message.method === 'Network.loadingFailed') {
      networkErrors.push(
        `${message.params?.errorText ?? 'network_error'}:${message.params?.type ?? 'unknown'}`,
      )
      return
    }
    if (message.method === 'Fetch.requestPaused') {
      void fulfillFixtureRequest(message.params).catch((error) => {
        console.error('Falha na fixture E2E:', error)
      })
      return
    }
    if (!message.id) return
    const operation = pending.get(message.id)
    if (!operation) return
    pending.delete(message.id)
    if (message.error) operation.reject(new Error(message.error.message))
    else operation.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const operation of pending.values()) {
      operation.reject(
        new Error('O navegador encerrou a conexão de auditoria.'),
      )
    }
    pending.clear()
  })

  await command('Page.enable')
  await command('Runtime.enable')
  await command('Network.enable')
  await command('Fetch.enable', {
    patterns: [{ urlPattern: `${baseUrl}/api/*`, requestStage: 'Request' }],
  })

  const report = []
  for (const viewport of viewports) {
    await command('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.name === 'mobile',
    })

    for (const route of routes) {
      await navigate(route)
      const result = await evaluate(`(() => {
        const visible = (element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
        }
        const describe = (element) => {
          const text = (element.getAttribute('aria-label') || element.textContent ||
            element.getAttribute('placeholder') || element.getAttribute('title') || '')
            .replace(/\\s+/g, ' ').trim().slice(0, 64)
          return element.tagName.toLowerCase() +
            (element.id ? '#' + element.id : '') +
            (element.classList.length ? '.' + [...element.classList].slice(0, 2).join('.') : '') +
            (text ? ' [' + text + ']' : '')
        }
        const accessibleName = (element) => {
          const labelledBy = element.getAttribute('aria-labelledby')
          const referenced = labelledBy
            ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
            : ''
          const explicit = element.id
            ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]')?.textContent || ''
            : ''
          const wrapped = element.closest('label')?.textContent || ''
          const ownText = ['BUTTON', 'A'].includes(element.tagName) ? element.textContent || '' : ''
          return (element.getAttribute('aria-label') || referenced || explicit || wrapped || ownText ||
            element.getAttribute('title') || '').replace(/\\s+/g, ' ').trim()
        }
        const elements = [...document.querySelectorAll('body *')].filter(visible)
        const interactive = elements.filter((element) =>
          !element.matches('.sr-only, input[type="file"]') &&
          element.matches('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="switch"]'))
        const smallTargets = interactive.filter((element) => {
          if (element.tagName === 'A' && getComputedStyle(element).display === 'inline') return false
          const control = ['checkbox', 'radio'].includes(element.getAttribute('type'))
            ? element.closest('label') || element
            : element
          const rect = control.getBoundingClientRect()
          return rect.width < 44 || rect.height < 44
        })
        const unnamed = interactive.filter((element) => !accessibleName(element))
        const overflow = elements.filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.right > innerWidth + 1 || rect.left < -1
        })
        return {
          path: location.pathname,
          title: document.title,
          h1: elements.filter((element) => element.tagName === 'H1').length,
          mains: document.querySelectorAll('main').length,
          nestedMains: document.querySelectorAll('main main').length,
          skipLink: Boolean(document.querySelector('a[href="#conteudo-principal"]')),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          overflowSamples: overflow.slice(0, 5).map(describe),
          unnamedControls: unnamed.slice(0, 5).map(describe),
          smallTargetCount: smallTargets.length,
          smallTargetSamples: smallTargets.slice(0, 5).map((element) => {
            const control = ['checkbox', 'radio'].includes(element.getAttribute('type'))
              ? element.closest('label') || element
              : element
            const rect = control.getBoundingClientRect()
            return describe(element) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height)
          }),
        }
      })()`)
      report.push({ viewport: viewport.name, ...result })
    }
  }

  await command('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await navigate('/dashboard')
  const menuKeyboard = await evaluate(`(async () => {
    const open = document.querySelector('button[aria-label="Abrir menu"]')
    open?.click()
    const focusDeadline = Date.now() + 1_000
    while (
      Date.now() < focusDeadline &&
      document.activeElement?.getAttribute('aria-label') !== 'Fechar menu'
    ) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    const opened = document.querySelector('#menu-principal')?.classList.contains('is-open')
    const closeFocused = document.activeElement?.getAttribute('aria-label') === 'Fechar menu'
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await new Promise((resolve) => setTimeout(resolve, 80))
    return {
      opened,
      closeFocused,
      closedWithEscape: !document.querySelector('#menu-principal')?.classList.contains('is-open'),
      focusReturned: document.activeElement?.getAttribute('aria-label') === 'Abrir menu',
    }
  })()`)

  await command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await navigate('/crm')
  const crmWorkflow = await evaluate(`(async () => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 8_000
      while (Date.now() < deadline) {
        const value = predicate()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      throw new Error('Tempo excedido no fluxo CRM: ' + label)
    }
    const button = (label) => [...document.querySelectorAll('button')]
      .find((item) => item.textContent?.replace(/\\s+/g, ' ').trim().includes(label))

    const createTrigger = await waitFor(() => button('Novo lead'), 'botão Novo lead')
    createTrigger.click()
    const title = await waitFor(
      () => document.querySelector('input[placeholder^="Ex.: Plano empresarial"]'),
      'campo de título',
    )
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set
    valueSetter.call(title, 'Lead criado no E2E')
    title.dispatchEvent(new Event('input', { bubbles: true }))
    const create = await waitFor(() => button('Criar lead'), 'salvar lead')
    create.click()
    await waitFor(
      () => document.body.textContent.includes('Lead criado e adicionado'),
      'confirmação de criação',
    )

    const leadButton = await waitFor(
      () => [...document.querySelectorAll('.crm-lead-open')].find(
        (item) => item.textContent.includes('Lead criado no E2E'),
      ),
      'card do lead criado',
    )
    leadButton.click()
    const stageSelect = await waitFor(
      () => [...document.querySelectorAll('.crm-lead-drawer select')].find(
        (item) => item.value === '${fixtureStages[0].id}',
      ),
      'seletor de etapa',
    )
    stageSelect.value = '${fixtureStages[1].id}'
    stageSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(
      () => document.body.textContent.includes('movido para Qualificação'),
      'confirmação da movimentação',
    )
    return {
      created: document.body.textContent.includes('Lead criado no E2E'),
      moved: stageSelect.value === '${fixtureStages[1].id}',
      loadingAbsent: !document.querySelector('.crm-loading'),
    }
  })()`)

  const failures = report.filter(
    (item) =>
      item.path === '/' ||
      item.h1 !== 1 ||
      item.mains !== 1 ||
      item.nestedMains !== 0 ||
      !item.skipLink ||
      item.horizontalOverflow ||
      item.unnamedControls.length > 0 ||
      item.smallTargetCount > 0,
  )

  console.log(
    JSON.stringify(
      {
        baseUrl,
        auditedRoutes: routes.length,
        viewports,
        checks: report.length,
        failures,
        menuKeyboard,
        crmWorkflow,
        routesWithSmallTargets: report
          .filter((item) => item.smallTargetCount > 0)
          .sort((left, right) => right.smallTargetCount - left.smallTargetCount)
          .slice(0, 12),
        maxSmallTargets: report.reduce(
          (current, item) =>
            item.smallTargetCount > current.smallTargetCount ? item : current,
          report[0],
        ),
      },
      null,
      2,
    ),
  )

  if (
    failures.length ||
    Object.values(menuKeyboard).some((value) => !value) ||
    Object.values(crmWorkflow).some((value) => !value)
  ) {
    process.exitCode = 1
  }
} finally {
  socket?.close()
  browser.kill()
  appServer?.kill()
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1_500)
    browser.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
  try {
    await rm(profilePath, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    // O Crashpad do Chromium pode segurar o arquivo por alguns milissegundos.
  }
}

async function waitForUrl(url, startupOutput) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // O Vite ainda está inicializando.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(
    `O servidor E2E não respondeu em ${url}.\n${startupOutput || serverOutput}`,
  )
}

function runProcess(commandPath, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandPath, args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-12_000)
    })
    child.stderr.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-12_000)
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`O build E2E falhou (código ${code}).\n${output}`))
    })
  })
}

function makeFixtureLead(title) {
  const id = `30000000-0000-4000-8000-${String(fixtureLeadCounter++).padStart(12, '0')}`
  const now = new Date().toISOString()
  return {
    id,
    pipelineId: fixturePipelineId,
    stageId: fixtureStages[0].id,
    contactId: null,
    title,
    description: 'Oportunidade usada apenas pelo teste determinístico.',
    status: 'open',
    lostReason: null,
    position: fixtureLeadCounter * 1000,
    valueCents: 100000,
    currency: 'BRL',
    ownerUserId: null,
    ownerName: null,
    lastActivityAt: now,
    nextActionAt: null,
    expectedCloseDate: null,
    source: 'e2e',
    sourceMetadata: {},
    customFields: {},
    tags: ['e2e'],
    lockVersion: 0,
    createdAt: now,
    updatedAt: now,
    contact: null,
    score: { probability: 50, reason: 'Fixture E2E', band: 'morno' },
    risk: null,
  }
}

function crmFixture(url) {
  const query = url.searchParams.get('q')?.trim().toLocaleLowerCase('pt-BR')
  const filtered = query
    ? fixtureLeads.filter((lead) =>
        `${lead.title} ${lead.description} ${lead.tags.join(' ')}`
          .toLocaleLowerCase('pt-BR')
          .includes(query),
      )
    : fixtureLeads
  const valueCents = fixtureLeads
    .filter((lead) => lead.status === 'open')
    .reduce((sum, lead) => sum + (lead.valueCents ?? 0), 0)
  return {
    pipelines: [
      {
        id: fixturePipelineId,
        name: 'Pipeline E2E',
        description: 'Fixture determinística',
        is_default: true,
        vocabulary: {},
        settings: {},
      },
    ],
    activePipelineId: fixturePipelineId,
    stages: fixtureStages,
    leads: filtered,
    members: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        name: 'Pessoa E2E',
        role: 'owner',
      },
    ],
    pagination: {
      page: 1,
      pageSize: 100,
      total: filtered.length,
      totalPages: 1,
    },
    permissions: { canWrite: true, canManagePipelines: true },
    summary: {
      open: fixtureLeads.filter((lead) => lead.status === 'open').length,
      won: fixtureLeads.filter((lead) => lead.status === 'won').length,
      lost: fixtureLeads.filter((lead) => lead.status === 'lost').length,
      valueCents,
      weightedValueCents: Math.round(valueCents * 0.5),
      atRisk: 0,
      overdue: 0,
      unassigned: fixtureLeads.filter(
        (lead) => lead.status === 'open' && !lead.ownerUserId,
      ).length,
    },
  }
}

async function fulfillFixtureRequest(event) {
  const url = new URL(event.request.url)
  const method = event.request.method
  let status = 200
  let body = { error: 'Rota sem fixture no ambiente E2E.' }

  if (url.pathname === '/api/crm' && method === 'GET') {
    body = crmFixture(url)
  } else if (url.pathname === '/api/crm' && method === 'POST') {
    const input = JSON.parse(event.request.postData || '{}')
    const created = makeFixtureLead(input.title || 'Lead sem título')
    created.description = input.description ?? null
    created.stageId = input.stageId ?? fixtureStages[0].id
    created.valueCents = input.valueCents ?? null
    created.source = input.source ?? 'manual'
    created.tags = input.tags ?? []
    fixtureLeads = [...fixtureLeads, created]
    status = 201
    body = { id: created.id, lock_version: created.lockVersion }
  } else if (/^\/api\/crm\/[0-9a-f-]+$/i.test(url.pathname)) {
    const leadId = url.pathname.split('/').at(-1)
    const lead = fixtureLeads.find((item) => item.id === leadId)
    if (!lead) {
      status = 404
      body = { error: 'Lead E2E não encontrado.' }
    } else if (method === 'GET') {
      body = { activities: [] }
    } else if (method === 'PATCH') {
      const input = JSON.parse(event.request.postData || '{}')
      if (input.kind === 'move') {
        const stage = fixtureStages.find((item) => item.id === input.stageId)
        lead.stageId = stage?.id ?? lead.stageId
        lead.status = stage?.terminal_state ?? lead.status
        lead.position = input.position ?? lead.position
        lead.lostReason = input.lostReason ?? null
      } else {
        lead.title = input.title ?? lead.title
        lead.description = input.description ?? lead.description
        lead.valueCents = input.valueCents ?? lead.valueCents
        lead.ownerUserId = input.ownerUserId ?? null
        lead.tags = input.tags ?? lead.tags
        lead.customFields = input.customFields ?? lead.customFields
      }
      lead.lockVersion += 1
      lead.updatedAt = new Date().toISOString()
      body = {
        id: lead.id,
        stage_id: lead.stageId,
        status: lead.status,
        lock_version: lead.lockVersion,
        updated_at: lead.updatedAt,
      }
    }
  } else if (url.pathname === '/api/contacts' && method === 'GET') {
    body = { contacts: [], pagination: { page: 1, total: 0, totalPages: 1 } }
  } else if (
    url.pathname === '/api/integrations/meta/status' &&
    method === 'GET'
  ) {
    body = { accounts: [], whatsapp: { accounts: [] } }
  } else {
    status = 503
  }

  await command('Fetch.fulfillRequest', {
    requestId: event.requestId,
    responseCode: status,
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'Cache-Control', value: 'no-store' },
    ],
    body: Buffer.from(JSON.stringify(body)).toString('base64'),
  })
}

function command(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Falha ao avaliar a página')
  }
  return result.result.value
}

async function navigate(route) {
  const usedClientNavigation = await evaluate(`(() => {
    if (!document.querySelector('main')) return false
    const link = [...document.querySelectorAll('a[href]')].find((item) => {
      try { return new URL(item.href).pathname === ${JSON.stringify(route)} }
      catch { return false }
    })
    if (!link) return false
    link.click()
    return true
  })()`)
  if (!usedClientNavigation)
    await command('Page.navigate', { url: `${baseUrl}${route}` })
  // O primeiro carregamento de uma rota no Vite pode compilar um bundle grande.
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const ready = await evaluate(`(() => {
      const appRoute = location.pathname !== '/'
      const loading = document.querySelector(
        '.loading-screen, .crm-loading',
      )
      return document.readyState === 'complete' &&
        location.pathname === ${JSON.stringify(route)} &&
        (!appRoute || (document.querySelector('main') && document.querySelector('h1'))) &&
        !loading
    })()`)
    if (ready) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return
    }
  }
  const diagnostic = await evaluate(`(() => ({
    path: location.pathname,
    readyState: document.readyState,
    mains: document.querySelectorAll('main').length,
    headings: document.querySelectorAll('h1').length,
    loading: [...document.querySelectorAll('.loading-screen, .crm-loading')]
      .map((item) => item.className),
    text: document.body.textContent.replace(/\\s+/g, ' ').trim().slice(0, 240),
    runtimeErrors: ${JSON.stringify(runtimeErrors)}.slice(-5),
    networkErrors: ${JSON.stringify(networkErrors)}.slice(-5),
    pendingResources: performance.getEntriesByType('resource')
      .filter((item) => item.responseEnd === 0)
      .map((item) => item.name).slice(-8),
    scripts: [...document.scripts].map((item) => item.src).filter(Boolean).slice(-8),
  }))()`)
  throw new Error(
    `Tempo excedido ao carregar ${route}: ${JSON.stringify(diagnostic)}`,
  )
}

async function waitForTarget(debugPort) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json()
      const target = targets.find((item) => item.type === 'page')
      if (target) return target
    } catch {
      // O navegador ainda está iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('O navegador não abriu a porta de depuração a tempo.')
}
