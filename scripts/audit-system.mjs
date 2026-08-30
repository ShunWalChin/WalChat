/** Auditoria estática reproduzível para limites HTTP, autenticação e assets públicos. */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const values = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name)
      return entry.isDirectory() ? filesBelow(target) : [target]
    }),
  )
  return values.flat()
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

const apiFiles = (await filesBelow(path.join(root, 'src/routes/api'))).filter(
  (file) => file.endsWith('.ts'),
)
const findings = []

for (const file of apiFiles) {
  const name = relative(file)
  const raw = await readFile(file, 'utf8')
  // Comentários descrevem o que NÃO se deve fazer e citam os próprios padrões
  // proibidos; varrê-los produziria falso positivo em cima da explicação.
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const isPublic =
    name.includes('/api/public/') ||
    name.includes('/api/privacy/') ||
    name.endsWith('/api/health.ts') ||
    name.endsWith('/api/ready.ts') ||
    name.endsWith('/api/data-deletion.ts') ||
    name.endsWith('/integrations/meta/callback.ts') ||
    name.endsWith('/integrations/google/callback.ts')
  const hasMutation = /\b(POST|PUT|PATCH|DELETE):\s*async/.test(source)
  const signedExternalMutation =
    name.endsWith('/api/data-deletion.ts') ||
    name.includes('/api/public/webhooks/')

  if (
    !isPublic &&
    !/requireWorkspaceContext|requireUserFromBearer/.test(source)
  )
    findings.push({
      severity: 'error',
      file: name,
      code: 'private_api_without_auth',
    })
  if (
    !isPublic &&
    hasMutation &&
    !signedExternalMutation &&
    !source.includes('assertTrustedOrigin')
  )
    findings.push({
      severity: 'error',
      file: name,
      code: 'mutation_without_origin_check',
    })
  // `request.json()` e `request.text()` bufferizam o corpo inteiro antes de
  // qualquer checagem de tamanho. Medir depois de ler já é tarde.
  if (/request\.(json|text|arrayBuffer|formData)\(\)/.test(source))
    findings.push({
      severity: 'error',
      file: name,
      code: 'unbounded_body_read',
    })
  // Endpoint anonimo sem cota vira amplificacao barata contra Postgres/Redis.
  if (
    isPublic &&
    !name.endsWith('/api/health.ts') &&
    !name.endsWith('/api/ready.ts')
  ) {
    if (!source.includes('assertRateLimit'))
      findings.push({
        severity: 'error',
        file: name,
        code: 'public_api_without_rate_limit',
      })
    // A chave do balde precisa vir do resolvedor endurecido; ler headers de IP
    // direto na rota reabre o bypass por header forjado.
    if (
      /headers\.get\('(cf-connecting-ip|x-forwarded-for|x-real-ip|true-client-ip)'/i.test(
        source,
      )
    )
      findings.push({
        severity: 'error',
        file: name,
        code: 'raw_client_ip_header_read',
      })
  }
}

const expectedPublicFiles = [
  'public/robots.txt',
  'public/sitemap.xml',
  'public/og.png',
  'public/manifest.json',
]
for (const name of expectedPublicFiles) {
  try {
    await readFile(path.join(root, name))
  } catch {
    findings.push({
      severity: 'error',
      file: name,
      code: 'missing_public_asset',
    })
  }
}

const robots = await readFile(path.join(root, 'public/robots.txt'), 'utf8')
if (!robots.includes('Sitemap:') || !robots.includes('Disallow: /api/'))
  findings.push({
    severity: 'error',
    file: 'public/robots.txt',
    code: 'robots_incomplete',
  })

const sitemap = await readFile(path.join(root, 'public/sitemap.xml'), 'utf8')
for (const route of ['/', '/privacidade', '/termos', '/exclusao-de-dados'])
  if (!sitemap.includes(`nip.io${route === '/' ? '/' : route}`))
    findings.push({
      severity: 'error',
      file: 'public/sitemap.xml',
      code: `missing_${route}`,
    })

// O motor de regex do Postgres recusa contagem de repetição acima de 255, e a
// expressão só é compilada quando alguém insere. Uma migration com `{1,2083}`
// cria a tabela sem reclamar e derruba todo insert depois — foi assim que a
// tabela de links de captação passou dias aceitando zero registros. O limite é
// invisível na revisão, então fica aqui.
const POSTGRES_MAX_REPETICAO = 255
for (const file of await filesBelow(path.join(root, 'supabase/migrations'))) {
  if (!file.endsWith('.sql')) continue
  // Comentário é prosa: a explicação do problema cita o número que o
  // auditor procura, e sem tirar os comentários ela mesma vira achado.
  const source = (await readFile(file, 'utf8')).replace(/--[^\n]*/g, '')
  for (const match of source.matchAll(/\{(\d+)(?:,(\d+))?\}/g)) {
    const maior = Number(match[2] ?? match[1])
    if (maior > POSTGRES_MAX_REPETICAO)
      findings.push({
        severity: 'error',
        file: relative(file),
        code: `regex_repetition_above_${POSTGRES_MAX_REPETICAO}`,
        detail: match[0],
      })
  }
}

const productionOnlyPlaceholders = []
const productionModuleGaps = []
for (const file of await filesBelow(path.join(root, 'src/routes/_app'))) {
  if (!file.endsWith('.tsx')) continue
  const source = await readFile(file, 'utf8')
  if (source.includes("from '../../lib/demo-data'"))
    productionOnlyPlaceholders.push(relative(file))
  if (source.includes('PrototypeNotice'))
    productionModuleGaps.push({
      file: relative(file),
      code: 'prototype_notice_present',
    })
}

const errors = findings.filter((finding) => finding.severity === 'error')
console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      apiFiles: apiFiles.length,
      findings,
      modulesStillUsingDemoData: productionOnlyPlaceholders,
      productionModuleGaps,
    },
    null,
    2,
  ),
)
if (errors.length) process.exitCode = 1
