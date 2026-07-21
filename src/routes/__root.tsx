/** Documento raiz: SEO, Open Graph, manifest, fontes, providers e scripts. */
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'
import { AuthProvider } from '../contexts/auth-context'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Wal Chat — seu Instagram no papo reto',
      },
      {
        name: 'description',
        content:
          'Automação, inbox, conteúdo e inteligência para creators brasileiros crescerem no Instagram sem perder o jeito humano.',
      },
      {
        name: 'theme-color',
        content: '#F05A28',
      },
      {
        property: 'og:title',
        content: 'Wal Chat — seu Instagram no papo reto',
      },
      {
        property: 'og:description',
        content: 'Automação, inbox, conteúdo e IA para creators brasileiros.',
      },
      {
        property: 'og:image',
        content: '/og.png',
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <Scripts />
      </body>
    </html>
  )
}
