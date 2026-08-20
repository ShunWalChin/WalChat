/** Smoke HTTP barato: confirma health e renderização SSR das rotas do produto. */
const appUrl = (process.env.SMOKE_APP_URL ?? 'http://127.0.0.1:3001').replace(
  /\/$/,
  '',
)

const routes = [
  '/',
  '/dashboard',
  '/operacoes',
  '/inbox',
  '/contatos',
  '/gatilhos',
  '/comment-to-dm',
  '/sequencias',
  '/agentes',
  '/reengajamento',
  '/calendario',
  '/publicar',
  '/auto-like',
  '/insights',
  '/configuracoes',
  '/manual',
  '/privacidade',
  '/termos',
  '/exclusao-de-dados',
]

const results = []

for (const route of routes) {
  const response = await fetch(`${appUrl}${route}`, { redirect: 'follow' })
  const body = await response.text()
  if (!response.ok || !body.includes('<html')) {
    throw new Error(`Rota ${route} falhou com status ${response.status}.`)
  }
  results.push({ route, status: response.status })
}

const healthResponse = await fetch(`${appUrl}/api/health`)
const health = await healthResponse.json()
if (!healthResponse.ok || !health.ok)
  throw new Error('Health check da aplicação falhou.')

console.log(
  JSON.stringify({ routes: results.length, health: 'ok', results }, null, 2),
)
