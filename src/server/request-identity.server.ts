/** Identidade opaca para rate limit; o hash final é aplicado pelo limitador. */
import '@tanstack/react-start/server-only'

export function requestIdentity(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown-client'
  )
}
