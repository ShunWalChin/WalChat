/** Documento raiz: SEO, Open Graph, manifest, fontes, providers e scripts. */
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'
import { AnalyticsConsent } from '../components/analytics-consent'
import { NotFoundPage } from '../components/not-found-page'
import { AuthProvider } from '../contexts/auth-context'
import { seoHead } from '../lib/seo'
import { publicStructuredData } from '../lib/site-config'

export const Route = createRootRoute({
  head: () => {
    const seo = seoHead({
      title: 'Wal Chat — automação e atendimento para creators',
      description:
        'Automação, inbox, CRM, calendário e IA para creators brasileiros atenderem e venderem com segurança.',
      path: '/',
    })
    return {
      meta: [
        {
          charSet: 'utf-8',
        },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          name: 'theme-color',
          content: '#F05A28',
        },
        ...seo.meta,
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', href: '/favicon.ico' },
        { rel: 'manifest', href: '/manifest.json' },
        ...seo.links,
      ],
      scripts: [
        {
          type: 'application/ld+json',
          children: JSON.stringify(publicStructuredData()).replace(
            /</g,
            '\\u003c',
          ),
        },
      ],
    }
  },
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider>
          {children}
          <AnalyticsConsent />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  )
}
