/** Parser CSV pequeno e determinístico para importação de oportunidades. */
export type ImportedCrmLead = {
  title: string
  description: string | null
  valueCents: number | null
  source: string
  tags: string[]
}

const headerAliases = {
  title: ['titulo', 'oportunidade', 'title'],
  description: ['descricao', 'contexto', 'description'],
  value: ['valor', 'value', 'valor estimado'],
  source: ['origem', 'source'],
  tags: ['tags', 'etiquetas'],
} as const

export function parseLeadCsv(source: string): ImportedCrmLead[] {
  if (source.length > 1_000_000) throw new Error('O CSV excede 1 MB.')
  const delimiter = detectDelimiter(source)
  const records = parseCsv(source, delimiter).filter((record) =>
    record.some((value) => value.trim()),
  )
  if (records.length < 2)
    throw new Error('O CSV precisa de cabeçalho e ao menos uma linha de lead.')
  if (records.length > 201)
    throw new Error('Importe no máximo 200 leads por arquivo.')

  const headers = records[0].map(normalizeHeader)
  const index = {
    title: findHeader(headers, headerAliases.title),
    description: findHeader(headers, headerAliases.description),
    value: findHeader(headers, headerAliases.value),
    source: findHeader(headers, headerAliases.source),
    tags: findHeader(headers, headerAliases.tags),
  }
  if (index.title < 0)
    throw new Error(
      'Inclua uma coluna “Título” ou “Oportunidade” no cabeçalho.',
    )

  return records.slice(1).map((record, rowIndex) => {
    const title = cell(record, index.title).trim()
    if (!title)
      throw new Error(`Linha ${rowIndex + 2}: o título é obrigatório.`)
    if (title.length > 160)
      throw new Error(`Linha ${rowIndex + 2}: o título excede 160 caracteres.`)
    const description = cell(record, index.description).trim()
    const sourceValue = cell(record, index.source).trim() || 'importacao_csv'
    const tags = Array.from(
      new Set(
        cell(record, index.tags)
          .split(/[|;]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ).slice(0, 30)
    return {
      title,
      description: description || null,
      valueCents: parseMoney(cell(record, index.value), rowIndex + 2),
      source: sourceValue,
      tags,
    }
  })
}

function parseCsv(source: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cellValue = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cellValue += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      row.push(cellValue)
      cellValue = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(cellValue)
      rows.push(row)
      row = []
      cellValue = ''
    } else {
      cellValue += character
    }
  }
  if (quoted) throw new Error('O CSV contém aspas abertas sem fechamento.')
  if (cellValue || row.length) {
    row.push(cellValue)
    rows.push(row)
  }
  return rows
}

function detectDelimiter(source: string) {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const commas = countOutsideQuotes(firstLine, ',')
  const semicolons = countOutsideQuotes(firstLine, ';')
  return semicolons > commas ? ';' : ','
}

function countOutsideQuotes(value: string, target: string) {
  let quoted = false
  let count = 0
  for (const character of value) {
    if (character === '"') quoted = !quoted
    else if (!quoted && character === target) count += 1
  }
  return count
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
}

function findHeader(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) =>
    aliases.some((alias) => alias === header),
  )
}

function cell(record: string[], index: number) {
  return index < 0 ? '' : (record[index] ?? '')
}

function parseMoney(value: string, line: number) {
  const trimmed = value.replace(/R\$/gi, '').replace(/\s/g, '').trim()
  if (!trimmed) return null
  const normalized = trimmed.includes(',')
    ? trimmed.replaceAll('.', '').replace(',', '.')
    : trimmed
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error(`Linha ${line}: o valor informado é inválido.`)
  const cents = Math.round(amount * 100)
  if (cents > 9_000_000_000)
    throw new Error(`Linha ${line}: o valor excede o limite permitido.`)
  return cents
}
