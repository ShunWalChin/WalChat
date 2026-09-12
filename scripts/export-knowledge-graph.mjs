/**
 * Exporta a lógica do sistema como grafo de conhecimento.
 *
 * É um gerador, e não um documento. Um documento escrito à mão sobre a
 * arquitetura começa correto e envelhece em silêncio: ninguém percebe quando
 * uma tabela muda de nome ou uma rota perde a autenticação. O grafo aqui é
 * reconstruído do código toda vez que roda, então ele não tem como divergir do
 * que está implantado.
 *
 * O que não dá para extrair — por que uma decisão foi tomada, qual armadilha
 * custou um dia de trabalho — vive em `knowledge/semantica.json`, escrito à
 * mão, e é costurado ao grafo extraído. Essa é a divisão: a máquina lê a
 * estrutura, a pessoa registra o motivo.
 *
 * Uso:
 *   node scripts/export-knowledge-graph.mjs            → escreve em knowledge/
 *   node scripts/export-knowledge-graph.mjs --stdout   → imprime o JSON
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const NL = String.fromCharCode(10)

async function arquivosEm(dir) {
  try {
    const itens = await readdir(dir, { withFileTypes: true })
    const listas = await Promise.all(
      itens.map((i) => {
        const alvo = path.join(dir, i.name)
        return i.isDirectory() ? arquivosEm(alvo) : [alvo]
      }),
    )
    return listas.flat()
  } catch {
    return []
  }
}

const rel = (f) => path.relative(root, f).split(path.sep).join('/')

/** Remove comentários antes de varrer, para a prosa não virar estrutura. */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const nos = new Map()
const arestas = []

function no(id, tipo, rotulo, atributos = {}) {
  if (!nos.has(id)) nos.set(id, { id, tipo, rotulo, ...atributos })
  else Object.assign(nos.get(id), atributos)
  return id
}

function aresta(de, relacao, para, atributos = {}) {
  if (!de || !para) return
  arestas.push({ de, relacao, para, ...atributos })
}

// ---------------------------------------------------------------------------
// 1. Persistência: tabelas, colunas e chaves estrangeiras
// ---------------------------------------------------------------------------

async function extrairPersistencia() {
  const migrations = (await arquivosEm(path.join(root, 'supabase/migrations')))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const arquivo of migrations) {
    const sql = (await readFile(arquivo, 'utf8')).replace(/--[^\n]*/g, '')
    const versao = path.basename(arquivo).slice(0, 14)

    // Cada `create table` abre um bloco que vai até o `);` na coluna zero.
    for (const m of sql.matchAll(
      /create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi,
    )) {
      const tabela = m[1]
      const corpo = m[2]
      const colunas = [
        ...corpo.matchAll(/^\s{2}([a-z_]+)\s+([a-z0-9 ()\[\]]+)/gim),
      ].map((c) => c[1])

      no(`tabela:${tabela}`, 'Entidade', tabela, {
        colunas: colunas.length,
        migration: versao,
        // Uma tabela sem `workspace_id` ou não é multi-tenant, ou é um
        // vazamento de isolamento esperando para acontecer.
        multiTenant: corpo.includes('workspace_id'),
      })

      for (const fk of corpo.matchAll(
        /([a-z_]+)[^,\n]*references\s+(?:public\.|auth\.)?([a-z_]+)\s*\(/gi,
      )) {
        aresta(`tabela:${tabela}`, 'referencia', `tabela:${fk[2]}`, {
          via: fk[1],
        })
      }
    }

    // Funções com `security definer` furam o RLS de propósito: quem lê o
    // esquema precisa saber quais são, porque são a superfície privilegiada.
    for (const f of sql.matchAll(
      /create (?:or replace )?function\s+(?:public\.)?([a-z_]+)/gi,
    )) {
      const nome = f[1]
      const trecho = sql.slice(f.index, f.index + 1200)
      no(`funcao:${nome}`, 'FuncaoBanco', nome, {
        securityDefiner: /security\s+definer/i.test(trecho),
        migration: versao,
      })
    }
  }

  // Tabelas citadas só como destino de FK (ex.: auth.users) entram como nó.
  for (const a of arestas)
    if (a.relacao === 'referencia' && !nos.has(a.para))
      no(a.para, 'Entidade', a.para.replace('tabela:', ''), { externa: true })
}

// ---------------------------------------------------------------------------
// 2. Superfície HTTP: rotas, métodos e o que elas exigem
// ---------------------------------------------------------------------------

async function extrairRotas() {
  const arquivos = (await arquivosEm(path.join(root, 'src/routes/api'))).filter(
    (f) => f.endsWith('.ts'),
  )

  for (const arquivo of arquivos) {
    const bruto = await readFile(arquivo, 'utf8')
    const fonte = semComentarios(bruto)
    const caminho = rel(arquivo)
      .replace('src/routes', '')
      .replace(/\.ts$/, '')
      .replace(/\/index$/, '')
      .replace(/\$([a-zA-Z]+)/g, ':$1')

    const metodos = [
      ...new Set(
        [
          ...fonte.matchAll(/^\s+(GET|POST|PUT|PATCH|DELETE|ANY):\s*async/gm),
        ].map((m) => m[1]),
      ),
    ]
    // Mesma definição que o auditor usa. Divergir aqui faria o grafo acusar
    // rota pública legítima como falha de autenticação — e um detector que
    // grita sem motivo é um detector que alguém passa a ignorar.
    const publica =
      caminho.startsWith('/api/public/') ||
      caminho.startsWith('/api/privacy/') ||
      /\/(health|ready|data-deletion)$/.test(caminho) ||
      caminho.includes('/callback') ||
      // O coringa `/api/$` devolve 404 para rota desconhecida: e publico
      // por natureza e nao tem o que autenticar.
      caminho.endsWith('/$')

    const id = no(`rota:${caminho}`, 'Rota', caminho, {
      metodos,
      publica,
      arquivo: rel(arquivo),
      exigeAutenticacao: /requireWorkspaceContext|requireUserFromBearer/.test(
        fonte,
      ),
      exigeOrigemConfiavel: fonte.includes('assertTrustedOrigin'),
      temLimiteDeTaxa: fonte.includes('assertRateLimit'),
      papeis: [
        ...new Set(
          [...fonte.matchAll(/'(owner|admin|agent|viewer)'/g)].map((m) => m[1]),
        ),
      ],
    })

    // Quais tabelas a rota toca, e se escreve nelas.
    for (const t of fonte.matchAll(/\.from\('([a-z_]+)'\)/g)) {
      const destino = `tabela:${t[1]}`
      if (!nos.has(destino)) continue
      const depois = fonte.slice(t.index, t.index + 260)
      aresta(
        id,
        /\.(insert|upsert|update|delete)\(/.test(depois) ? 'escreve' : 'le',
        destino,
      )
    }
    for (const r of fonte.matchAll(/\.rpc\('([a-z_]+)'/g))
      aresta(id, 'invoca', `funcao:${r[1]}`)
    for (const i of fonte.matchAll(
      /from '[^']*server\/([a-z0-9-]+)(?:\.server)?'/g,
    ))
      aresta(id, 'usa', `modulo:${i[1]}`)
  }
}

// ---------------------------------------------------------------------------
// 3. Módulos de servidor e as dependências entre eles
// ---------------------------------------------------------------------------

async function extrairModulos() {
  const arquivos = (await arquivosEm(path.join(root, 'src/server')))
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
    .concat(
      (await arquivosEm(path.join(root, 'src/workers'))).filter((f) =>
        f.endsWith('.ts'),
      ),
    )

  for (const arquivo of arquivos) {
    const bruto = await readFile(arquivo, 'utf8')
    const fonte = semComentarios(bruto)
    const nome = path.basename(arquivo).replace(/\.(server\.)?ts$/, '')
    const ehWorker = arquivo.includes('workers')

    // A primeira frase do cabeçalho do arquivo costuma dizer para que ele
    // serve melhor do que qualquer nome de variável.
    const cabecalho = bruto.match(/^\/\*\*([\s\S]*?)\*\//)
    const proposito = cabecalho
      ? cabecalho[1]
          .replace(/^\s*\*\s?/gm, '')
          .trim()
          .split(/\.\s|\n\n/)[0]
          .replace(/\s+/g, ' ')
          .slice(0, 190)
      : null

    const id = no(`modulo:${nome}`, ehWorker ? 'Worker' : 'Modulo', nome, {
      arquivo: rel(arquivo),
      proposito,
      linhas: bruto.split(NL).length,
      somenteServidor: fonte.includes('react-start/server-only'),
      exporta: [
        ...new Set(
          [
            ...fonte.matchAll(
              /^export (?:async )?(?:function|const|class)\s+(\w+)/gm,
            ),
          ].map((m) => m[1]),
        ),
      ],
    })

    for (const i of fonte.matchAll(/from '\.\/([a-z0-9-]+)(?:\.server)?'/g))
      if (i[1] !== nome) aresta(id, 'importa', `modulo:${i[1]}`)
    for (const t of fonte.matchAll(/\.from\('([a-z_]+)'\)/g)) {
      const destino = `tabela:${t[1]}`
      if (!nos.has(destino)) continue
      const depois = fonte.slice(t.index, t.index + 260)
      aresta(
        id,
        /\.(insert|upsert|update|delete)\(/.test(depois) ? 'escreve' : 'le',
        destino,
      )
    }
    for (const r of fonte.matchAll(/\.rpc\('([a-z_]+)'/g))
      aresta(id, 'invoca', `funcao:${r[1]}`)
  }
}

// ---------------------------------------------------------------------------
// 4. Telas e as rotas que elas consomem
// ---------------------------------------------------------------------------

async function extrairTelas() {
  const arquivos = (
    await arquivosEm(path.join(root, 'src/routes/_app'))
  ).filter((f) => f.endsWith('.tsx'))
  for (const arquivo of arquivos) {
    const fonte = semComentarios(await readFile(arquivo, 'utf8'))
    const nome = path.basename(arquivo, '.tsx')
    const id = no(`tela:${nome}`, 'Tela', nome, { arquivo: rel(arquivo) })
    for (const c of fonte.matchAll(/'(\/api\/[a-zA-Z0-9/_-]+)/g)) {
      const alvo = `rota:${c[1].replace(/\/$/, '')}`
      if (nos.has(alvo)) aresta(id, 'consome', alvo)
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Camada semântica: o que só uma pessoa sabe
// ---------------------------------------------------------------------------

async function costurarSemantica() {
  let semantica
  try {
    semantica = JSON.parse(
      await readFile(path.join(root, 'knowledge/semantica.json'), 'utf8'),
    )
  } catch {
    return { regras: 0, decisoes: 0, armadilhas: 0, fluxos: 0, orfaos: [] }
  }

  const orfaos = []
  const ligar = (de, relacao, alvos = []) => {
    for (const alvo of alvos) {
      if (!nos.has(alvo)) orfaos.push(`${de} -${relacao}-> ${alvo}`)
      aresta(de, relacao, alvo)
    }
  }

  for (const r of semantica.regras ?? []) {
    const id = no(`regra:${r.id}`, 'Regra', r.nome, {
      enunciado: r.enunciado,
      porque: r.porque,
      ondeVive: r.ondeVive,
      severidade: r.severidade,
    })
    ligar(id, 'implementada_em', r.implementadaEm)
    ligar(id, 'protege', r.protege)
  }

  for (const d of semantica.decisoes ?? []) {
    const id = no(`decisao:${d.id}`, 'Decisao', d.nome, {
      escolha: d.escolha,
      alternativaRejeitada: d.alternativaRejeitada,
      porque: d.porque,
      data: d.data,
    })
    ligar(id, 'decide_sobre', d.decideSobre)
  }

  for (const a of semantica.armadilhas ?? []) {
    const id = no(`armadilha:${a.id}`, 'Armadilha', a.nome, {
      sintoma: a.sintoma,
      causa: a.causa,
      defesa: a.defesa,
      custou: a.custou,
    })
    ligar(id, 'atingiu', a.atingiu)
  }

  for (const f of semantica.fluxos ?? []) {
    const id = no(`fluxo:${f.id}`, 'Fluxo', f.nome, {
      gatilho: f.gatilho,
      resultado: f.resultado,
    })
    f.passos?.forEach((passo, i) => {
      if (!nos.has(passo)) orfaos.push(`${id} -passo ${i + 1}-> ${passo}`)
      aresta(id, 'passo', passo, { ordem: i + 1 })
    })
  }

  for (const s of semantica.sistemasExternos ?? []) {
    const id = no(`externo:${s.id}`, 'SistemaExterno', s.nome, {
      papel: s.papel,
      falhaQuando: s.falhaQuando,
    })
    ligar(id, 'acessado_por', s.acessadoPor)
  }

  return {
    regras: (semantica.regras ?? []).length,
    decisoes: (semantica.decisoes ?? []).length,
    armadilhas: (semantica.armadilhas ?? []).length,
    fluxos: (semantica.fluxos ?? []).length,
    orfaos,
  }
}

// ---------------------------------------------------------------------------

async function main() {
  await extrairPersistencia()
  await extrairRotas()
  await extrairModulos()
  await extrairTelas()
  const semantica = await costurarSemantica()

  // Arestas para nós que não existem seriam mentira no grafo: um caminho que
  // parece existir e não existe é pior que uma lacuna declarada.
  const validas = arestas.filter((a) => nos.has(a.de) && nos.has(a.para))
  const descartadas = arestas.length - validas.length

  const porTipo = {}
  for (const n of nos.values()) porTipo[n.tipo] = (porTipo[n.tipo] ?? 0) + 1
  const porRelacao = {}
  for (const a of validas)
    porRelacao[a.relacao] = (porRelacao[a.relacao] ?? 0) + 1

  const grafo = {
    gerado: new Date().toISOString(),
    sistema: 'Wal Chat',
    resumo: {
      nos: nos.size,
      arestas: validas.length,
      porTipo,
      porRelacao,
      arestasDescartadas: descartadas,
      semantica,
    },
    nos: [...nos.values()].sort((a, b) => a.id.localeCompare(b.id)),
    arestas: validas.sort(
      (a, b) => a.de.localeCompare(b.de) || a.para.localeCompare(b.para),
    ),
  }

  if (process.argv.includes('--stdout')) {
    console.log(JSON.stringify(grafo, null, 2))
    return
  }

  await mkdir(path.join(root, 'knowledge'), { recursive: true })
  await writeFile(
    path.join(root, 'knowledge/grafo.json'),
    JSON.stringify(grafo, null, 2) + NL,
  )
  // JSONL para quem quer carregar linha a linha, sem parsear o arquivo todo.
  await writeFile(
    path.join(root, 'knowledge/grafo.jsonl'),
    [
      ...grafo.nos.map((n) => JSON.stringify({ registro: 'no', ...n })),
      ...grafo.arestas.map((a) => JSON.stringify({ registro: 'aresta', ...a })),
    ].join(NL) + NL,
  )

  console.log(JSON.stringify(grafo.resumo, null, 2))
  if (semantica.orfaos?.length) {
    console.log(NL + 'Referências semânticas sem nó correspondente:')
    for (const o of semantica.orfaos) console.log('  ' + o)
    process.exitCode = 1
  }
}

await main()
