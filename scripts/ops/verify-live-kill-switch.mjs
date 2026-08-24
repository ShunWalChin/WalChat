#!/usr/bin/env node

/** Confirma no runtime live que o workspace bloqueia I/O externo. */

const serverRoot = (
  process.env.WAL_CHAT_SERVER_ROOT || new URL('../../src', import.meta.url).href
).replace(/\/$/, '')
const { assertWorkspaceExternalSendsEnabled } = await import(
  `${serverRoot}/server/go-live.server.ts`
)
const { getSupabaseAdmin } = await import(
  `${serverRoot}/server/supabase-admin.server.ts`
)

if (process.env.DEMO_MODE !== 'false')
  throw new Error('O runtime não está em live mode.')

const supabase = getSupabaseAdmin()
if (!supabase) throw new Error('Supabase administrativo indisponível.')
const { data, error } = await supabase.from('workspaces').select('id').limit(1)
if (error) throw error
if (!data?.[0]?.id) throw new Error('Workspace de teste não encontrado.')

let blocked = false
let code = null
try {
  await assertWorkspaceExternalSendsEnabled(data[0].id)
} catch (caught) {
  code =
    caught && typeof caught === 'object' && 'code' in caught
      ? caught.code
      : null
  blocked = code === 'external_sends_disabled'
}

console.log(
  JSON.stringify({
    ok: blocked,
    liveMode: true,
    externalIoBlocked: blocked,
    reason: code,
  }),
)
process.exitCode = blocked ? 0 : 1
