/** Impede que telas-chave cresçam silenciosamente e prejudiquem a operação. */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const assetsDir = join(process.cwd(), 'dist', 'client', 'assets')
const files = await readdir(assetsDir)
const assets = await Promise.all(
  files.map(async (name) => ({
    name,
    bytes: (await stat(join(assetsDir, name))).size,
  })),
)

const budgets = [
  { label: 'chunk do CRM', pattern: /^crm-.*\.js$/, maxBytes: 120_000 },
  {
    label: 'entrada da aplicação',
    pattern: /^index-.*\.js$/,
    maxBytes: 280_000,
  },
  { label: 'CSS global', pattern: /^styles-.*\.css$/, maxBytes: 220_000 },
]
const failures = []
for (const budget of budgets) {
  const matching = assets.filter((asset) => budget.pattern.test(asset.name))
  if (!matching.length) {
    failures.push(`${budget.label}: artefato não encontrado`)
    continue
  }
  for (const asset of matching)
    if (asset.bytes > budget.maxBytes)
      failures.push(
        `${budget.label}: ${asset.name} tem ${asset.bytes} bytes; limite ${budget.maxBytes}`,
      )
}

const largestJavaScript = assets
  .filter((asset) => asset.name.endsWith('.js'))
  .sort((left, right) => right.bytes - left.bytes)[0]
if (largestJavaScript?.bytes > 360_000)
  failures.push(
    `maior chunk JavaScript: ${largestJavaScript.name} tem ${largestJavaScript.bytes} bytes; limite 360000`,
  )

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      budgets: budgets.map((budget) => ({
        label: budget.label,
        maxBytes: budget.maxBytes,
        assets: assets.filter((asset) => budget.pattern.test(asset.name)),
      })),
      largestJavaScript,
      failures,
    },
    null,
    2,
  ),
)

if (failures.length) process.exitCode = 1
