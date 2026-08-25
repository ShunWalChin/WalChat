import { describe, expect, it } from 'vitest'
import { createNonceTransform, injectNonceIntoHtml } from './html-nonce.mjs'

async function streamThrough(chunks, nonce) {
  const encoder = new TextEncoder()
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  const reader = source.pipeThrough(createNonceTransform(nonce)).getReader()
  const decoder = new TextDecoder()
  let result = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result + decoder.decode()
}

describe('injeção de nonce no HTML do SSR', () => {
  it('marca script inline e script com src', () => {
    const html = injectNonceIntoHtml(
      '<script type="application/ld+json">{}</script><script src="/a.js"></script>',
      'abc123',
    )
    expect(html).toBe(
      '<script nonce="abc123" type="application/ld+json">{}</script>' +
        '<script nonce="abc123" src="/a.js"></script>',
    )
  })

  it('não toca na tag de fechamento', () => {
    expect(injectNonceIntoHtml('<script>x</script>', 'n')).toBe(
      '<script nonce="n">x</script>',
    )
  })

  it('ignora palavras que apenas começam com script', () => {
    expect(injectNonceIntoHtml('<scripting>', 'n')).toBe('<scripting>')
  })

  it('devolve o HTML intacto quando não há nonce', () => {
    expect(injectNonceIntoHtml('<script>x</script>', undefined)).toBe(
      '<script>x</script>',
    )
  })

  it('marca a tag mesmo partida entre chunks', async () => {
    const output = await streamThrough(['<html><scr', 'ipt>x</script>'], 'n1')
    expect(output).toBe('<html><script nonce="n1">x</script>')
  })

  it('marca a tag que termina exatamente na fronteira do chunk', async () => {
    // `<script` completo no primeiro chunk e o `>` que o confirma no segundo.
    const output = await streamThrough(['a<script', '>x</script>'], 'n2')
    expect(output).toBe('a<script nonce="n2">x</script>')
  })

  it('preserva o conteúdo quando o corpo chega em muitos pedaços', async () => {
    const html =
      '<script>1</script><div>meio</div><script src="/b.js"></script>'
    const chunks = html.match(/.{1,3}/gs) ?? []
    const output = await streamThrough(chunks, 'n3')
    expect(output).toBe(
      '<script nonce="n3">1</script><div>meio</div>' +
        '<script nonce="n3" src="/b.js"></script>',
    )
  })
})
