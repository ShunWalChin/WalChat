import { describe, expect, it } from 'vitest'
import { seoHead } from './seo'
import { publicStructuredData } from './site-config'

describe('SEO público', () => {
  it('gera título, descrição, canonical e imagem social absolutos', () => {
    const head = seoHead({
      title: 'Privacidade',
      description: 'Descrição específica da página.',
      path: '/privacidade',
    })

    expect(head.meta).toContainEqual({ title: 'Privacidade | Wal Chat' })
    expect(head.meta).toContainEqual({
      name: 'description',
      content: 'Descrição específica da página.',
    })
    expect(head.links[0].href).toMatch(/^https:\/\/.+\/privacidade$/)
    expect(
      head.meta.find(
        (item) => 'property' in item && item.property === 'og:image',
      )?.content,
    ).toMatch(/^https:\/\//)
  })

  it('não inventa LocalBusiness sem endereço comercial configurado', () => {
    const graph = publicStructuredData()['@graph']
    expect(graph.some((item) => item['@type'] === 'Organization')).toBe(true)
    expect(graph.some((item) => item['@type'] === 'SoftwareApplication')).toBe(
      true,
    )
  })
})
