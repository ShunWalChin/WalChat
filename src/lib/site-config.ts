/** Configuração pública de marca e localização; nunca coloque secrets neste arquivo. */
const defaultOrigin = 'https://wal-chat.64.181.178.125.nip.io'

function clean(value: string | undefined) {
  return value?.trim() || null
}

function httpUrl(value: string | undefined) {
  const candidate = clean(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

export const siteConfig = {
  name: 'Wal Chat',
  origin: (
    httpUrl(import.meta.env.VITE_PUBLIC_SITE_URL) ?? defaultOrigin
  ).replace(/\/$/, ''),
  description:
    'Automação, inbox, CRM, calendário e inteligência para creators brasileiros atenderem e venderem com segurança.',
  supportEmail:
    clean(import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL) ??
    'privacidade@walchat.com.br',
  responseSla:
    clean(import.meta.env.VITE_PUBLIC_RESPONSE_SLA) ??
    'Resposta humana em até 1 dia útil.',
  analyticsId: clean(import.meta.env.VITE_GA_MEASUREMENT_ID),
  businessAddress: clean(import.meta.env.VITE_PUBLIC_BUSINESS_ADDRESS),
  businessHours: clean(import.meta.env.VITE_PUBLIC_BUSINESS_HOURS),
  mapsUrl: httpUrl(import.meta.env.VITE_PUBLIC_GOOGLE_MAPS_URL),
  mapsEmbedUrl: httpUrl(import.meta.env.VITE_PUBLIC_GOOGLE_MAPS_EMBED_URL),
}

export function absoluteUrl(path: string) {
  return new URL(path, `${siteConfig.origin}/`).toString()
}

/** JSON-LD sem avaliações inventadas; LocalBusiness só existe com endereço real. */
export function publicStructuredData() {
  const graph: Array<Record<string, unknown>> = [
    {
      '@type': 'Organization',
      '@id': `${siteConfig.origin}/#organization`,
      name: siteConfig.name,
      url: siteConfig.origin,
      logo: absoluteUrl('/logo512.png'),
      email: siteConfig.supportEmail,
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteConfig.origin}/#software`,
      name: siteConfig.name,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: siteConfig.origin,
      description: siteConfig.description,
      inLanguage: 'pt-BR',
      publisher: { '@id': `${siteConfig.origin}/#organization` },
    },
  ]

  if (siteConfig.businessAddress) {
    graph.push({
      '@type': 'LocalBusiness',
      '@id': `${siteConfig.origin}/#local-business`,
      name: siteConfig.name,
      url: siteConfig.origin,
      image: absoluteUrl('/og.png'),
      email: siteConfig.supportEmail,
      address: {
        '@type': 'PostalAddress',
        streetAddress: siteConfig.businessAddress,
        addressLocality: 'São Paulo',
        addressRegion: 'SP',
        addressCountry: 'BR',
      },
      ...(siteConfig.businessHours
        ? { openingHours: siteConfig.businessHours }
        : {}),
      ...(siteConfig.mapsUrl ? { hasMap: siteConfig.mapsUrl } : {}),
    })
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  }
}
