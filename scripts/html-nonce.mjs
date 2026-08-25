/**
 * Injeção de nonce nos scripts do HTML gerado pelo SSR.
 *
 * O bundle TanStack Start emite três scripts inline (JSON-LD, estado do router
 * e a barreira de streaming). Sem nonce, a CSP precisaria de `'unsafe-inline'`,
 * que autoriza igualmente o script legítimo e o injetado por XSS. Marcar cada
 * tag com o nonce da requisição permite remover `'unsafe-inline'` da política.
 *
 * O nonce também é aplicado às tags com `src`: é inofensivo e mantém a
 * transformação sem estado de parsing.
 */
const OPENING_TAG = /<script(?=[\s>])/g

// `</script` nunca casa porque a barra fica entre `<` e `script`. O resto
// retido precisa cobrir `<script` inteiro mais o caractere de lookahead: sem o
// +1, uma tag que termina exatamente na fronteira sairia sem nonce porque o
// delimitador que a confirma ainda estaria no chunk seguinte.
const MAX_CARRY = '<script'.length + 1

export function injectNonceIntoHtml(html, nonce) {
  if (!nonce) return html
  return html.replace(OPENING_TAG, `<script nonce="${nonce}"`)
}

/**
 * Faz a mesma substituição sobre um corpo em streaming, sem bufferizar a
 * resposta inteira. O resto retido no fim de cada chunk cobre uma tag partida
 * na fronteira.
 */
export function createNonceTransform(nonce) {
  const decoder = new TextDecoder('utf-8')
  const encoder = new TextEncoder()
  let carry = ''

  return new TransformStream({
    transform(chunk, controller) {
      const text = carry + decoder.decode(chunk, { stream: true })
      const cut = safeCutPoint(text)
      carry = text.slice(cut)
      const emit = text.slice(0, cut)
      if (emit)
        controller.enqueue(encoder.encode(injectNonceIntoHtml(emit, nonce)))
    },
    flush(controller) {
      const tail = carry + decoder.decode()
      if (tail)
        controller.enqueue(encoder.encode(injectNonceIntoHtml(tail, nonce)))
    },
  })
}

/**
 * Corta no último `<` que ainda pode abrir uma tag incompleta.
 *
 * Reter simplesmente os N últimos caracteres não basta: uma tag que começa
 * pouco antes do corte e termina depois dele sairia partida em dois pedaços e
 * nenhum deles casaria com o padrão. Se o último `<` está mais atrás do que o
 * comprimento máximo de interesse, toda tag que ele abriu já está completa.
 */
function safeCutPoint(text) {
  const windowStart = Math.max(0, text.length - MAX_CARRY)
  const lastOpen = text.lastIndexOf('<')
  return lastOpen >= windowStart ? lastOpen : text.length
}
