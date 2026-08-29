/**
 * Metadados das páginas públicas.
 *
 * Vive no cliente porque o SSR renderiza o `<head>` junto com a página; separar
 * daria dois lugares para a mesma verdade.
 */
import { absoluteUrl, siteConfig } from './site-config'

type SeoInput = {
  title: string
  description: string
  path: string
  noindex?: boolean
}

/** Metadados consistentes, únicos e absolutos para SSR, busca e compartilhamento. */
export function seoHead({ title, description, path, noindex }: SeoInput) {
  const fullTitle = title.includes('Wal Chat') ? title : `${title} | Wal Chat`
  const canonical = absoluteUrl(path)
  return {
    meta: [
      { title: fullTitle },
      { name: 'description', content: description },
      {
        name: 'robots',
        content: noindex
          ? 'noindex, nofollow, noarchive'
          : 'index, follow, max-image-preview:large',
      },
      { property: 'og:locale', content: 'pt_BR' },
      { property: 'og:site_name', content: siteConfig.name },
      { property: 'og:title', content: fullTitle },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: canonical },
      { property: 'og:image', content: absoluteUrl('/og.png') },
      {
        property: 'og:image:alt',
        content: 'Wal Chat: automação, inbox, conteúdo e IA no papo reto.',
      },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: fullTitle },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: absoluteUrl('/og.png') },
    ],
    links: [{ rel: 'canonical', href: canonical }],
  }
}
