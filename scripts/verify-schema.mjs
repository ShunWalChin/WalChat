/**
 * Gera as sondas SQL que provam o que a aplicação das migrations não prova.
 *
 * Aplicar uma migration só garante que o DDL é válido. Uma expressão regular
 * dentro de um `check` não é compilada na criação da tabela — só quando alguém
 * insere. Foi assim que `growth_links` nasceu recusando todo registro: a
 * migration passou limpa, a tabela existia, e todo insert morria com
 * `invalid repetition count(s)`.
 *
 * Este script varre as migrations, extrai cada literal usado com os operadores
 * de regex do Postgres (`~`, `~*`, `!~`, `!~*`) e emite um `select` que força a
 * compilação de cada um. O que não compilar derruba o portão.
 *
 * Uso:  node scripts/verify-schema.mjs | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raizDoProjeto = join(dirname(fileURLToPath(import.meta.url)), '..')
const pastaDeMigrations = join(raizDoProjeto, 'supabase', 'migrations')

/** Casa `~ 'padrao'` e variantes, capturando o literal entre aspas simples. */
const OPERADOR_DE_REGEX = /(?:!?~\*?)\s*'((?:[^']|'')*)'/g

function extrairPadroes(sql) {
  const encontrados = new Map()
  for (const casamento of sql.matchAll(OPERADOR_DE_REGEX)) {
    const padrao = casamento[1]
    if (!padrao) continue
    encontrados.set(padrao, (encontrados.get(padrao) ?? 0) + 1)
  }
  return encontrados
}

const arquivos = readdirSync(pastaDeMigrations)
  .filter((nome) => nome.endsWith('.sql'))
  .sort()

const linhas = [
  '-- Gerado por scripts/verify-schema.mjs — não editar à mão.',
  '\\set ON_ERROR_STOP on',
]
let total = 0

for (const arquivo of arquivos) {
  const sql = readFileSync(join(pastaDeMigrations, arquivo), 'utf8')
  const padroes = extrairPadroes(sql)
  if (!padroes.size) continue
  linhas.push(`-- ${arquivo}`)
  for (const padrao of padroes.keys()) {
    total += 1
    // O resultado é descartado: o que importa é o Postgres compilar o padrão.
    linhas.push(`select 'sonda' ~ '${padrao}' as descartado;`)
  }
}

linhas.push(
  `\\echo '${total} expressão(ões) regular(es) de migration compilada(s) com sucesso'`,
)

process.stdout.write(`${linhas.join('\n')}\n`)
