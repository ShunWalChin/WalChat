# Grafo de conhecimento do Wal Chat

A lógica do sistema como nós e relações. Gerado com:

```bash
npm run knowledge:export
```

## Por que é gerado e não escrito

Um documento de arquitetura mantido à mão começa correto e envelhece calado.
Ninguém percebe quando uma tabela muda de nome, quando uma rota perde a
autenticação ou quando um módulo passa a escrever numa tabela que antes só lia.

O grafo é reconstruído do código a cada execução, então não tem como divergir do
que está implantado. O que a máquina não consegue ler — por que uma decisão foi
tomada, qual armadilha custou um dia — fica em `semantica.json`, escrito à mão, e
é costurado por cima.

**Toda referência da camada escrita é validada.** Se um id deixar de existir, o
gerador imprime a referência quebrada e sai com código 1, em vez de gerar um
caminho que parece existir e não existe.

## Arquivos

| Arquivo          | O que é                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `grafo.json`     | Grafo completo: resumo, nós e arestas. Gerado.                           |
| `grafo.jsonl`    | O mesmo, uma linha por registro, para carregar em fluxo. Gerado.         |
| `semantica.json` | Regras, decisões, armadilhas, fluxos e sistemas externos. Escrito à mão. |

Os dois gerados estão no `.prettierignore`: formatar saída de gerador só faz o
portão de verificação falhar depois de cada execução.

## Modelo

**Nós extraídos do código** — `Entidade` (tabela), `Rota`, `Modulo`, `Worker`,
`Tela`, `FuncaoBanco`.

**Nós escritos à mão** — `Regra`, `Decisao`, `Armadilha`, `Fluxo`,
`SistemaExterno`.

**Relações** — `referencia` (chave estrangeira), `le`, `escreve`, `usa`,
`importa`, `invoca`, `consome`, `implementada_em`, `protege`, `decide_sobre`,
`atingiu`, `passo`, `acessado_por`.

## O que ele responde

O valor não é o desenho: é poder perguntar. Alguns exemplos que rodam direto:

```js
const g = require('./knowledge/grafo.json')

// Rota privada que esqueceu a autenticação
g.nos.filter((n) => n.tipo === 'Rota' && !n.publica && !n.exigeAutenticacao)

// Mutação sem checagem de origem confiável
g.nos.filter(
  (n) =>
    n.tipo === 'Rota' &&
    !n.publica &&
    n.metodos.some((m) => m !== 'GET') &&
    !n.exigeOrigemConfiavel,
)

// Tabela operacional sem workspace_id — vazamento de isolamento esperando
g.nos.filter((n) => n.tipo === 'Entidade' && !n.externa && !n.multiTenant)

// Quem escreve numa tabela, e por qual caminho
g.arestas
  .filter((a) => a.relacao === 'escreve' && a.para === 'tabela:bookings')
  .map((a) => a.de)

// Que regra protege esta tabela, e onde ela é implementada
g.arestas.filter((a) => a.relacao === 'protege' && a.para === 'tabela:messages')
```

A última é a que mais importa na prática: antes de mexer numa tabela, ver quais
invariantes dependem dela.

## Manter

Ao acrescentar uma regra, decisão ou armadilha, edite `semantica.json` e rode o
gerador. Ele recusa referência a nó inexistente, então um id errado aparece na
hora e não vira documentação falsa.

O campo `porque` é o que dá valor ao registro. Sem ele, a entrada repete o que o
código já diz.
