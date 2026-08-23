/** Smoke HTTP barato: confirma health e renderização SSR das rotas do produto. */
const appUrl = (process.env.SMOKE_APP_URL ?? 'http://127.0.0.1:3001').replace(
  /\/$/,
  '',
)

const htmlRoutes = [
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
  '/integracoes',
  '/manual',
  '/privacidade',
  '/termos',
  '/exclusao-de-dados',
  '/obrigado',
]

const results = []
const publicTitles = new Map()

for (const route of htmlRoutes) {
  const response = await fetch(`${appUrl}${route}`, { redirect: 'follow' })
  const body = await response.text()
  if (!response.ok || !body.includes('<html')) {
    throw new Error(`Rota ${route} falhou com status ${response.status}.`)
  }
  const title = body.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim()
  if (!title) throw new Error(`Rota ${route} não possui title SSR.`)
  if (
    [
      '/',
      '/privacidade',
      '/termos',
      '/exclusao-de-dados',
      '/obrigado',
    ].includes(route)
  ) {
    if (publicTitles.has(title))
      throw new Error(
        `Título público repetido em ${route} e ${publicTitles.get(title)}.`,
      )
    publicTitles.set(title, route)
  }
  results.push({ route, status: response.status })
}

const missingResponse = await fetch(
  `${appUrl}/endereco-que-nao-existe-wal-chat`,
)
const missingBody = await missingResponse.text()
if (
  missingResponse.status !== 404 ||
  !missingBody.includes('Virou na esquina errada')
)
  throw new Error('Página 404 não devolveu status e recuperação esperados.')

const robotsResponse = await fetch(`${appUrl}/robots.txt`)
const robots = await robotsResponse.text()
if (
  !robotsResponse.ok ||
  !robots.includes('Sitemap:') ||
  !robots.includes('Disallow: /api/')
)
  throw new Error('robots.txt incompleto.')

const sitemapResponse = await fetch(`${appUrl}/sitemap.xml`)
const sitemap = await sitemapResponse.text()
if (
  !sitemapResponse.ok ||
  !sitemap.includes('<urlset') ||
  !sitemap.includes('/privacidade')
)
  throw new Error('sitemap.xml incompleto.')

const healthResponse = await fetch(`${appUrl}/api/health`)
const health = await healthResponse.json()
if (!healthResponse.ok || !health.ok || health.service !== 'wal-chat')
  throw new Error('Health check da aplicação falhou.')

console.log(
  JSON.stringify(
    {
      routes: results.length,
      publicTitles: publicTitles.size,
      notFound: missingResponse.status,
      robots: 'ok',
      sitemap: 'ok',
      health: 'ok',
      results,
    },
    null,
    2,
  ),
)
