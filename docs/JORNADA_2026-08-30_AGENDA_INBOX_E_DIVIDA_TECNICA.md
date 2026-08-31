# 30 de agosto de 2026 — agenda, Inbox e dívida técnica

Registro consolidado de um dia de trabalho. Está aqui porque o que mais importa
não são as funcionalidades entregues, e sim **o padrão de defeito que apareceu**:
dezoito problemas encontrados, e dezesseis deles em camadas que os 348 testes da
suíte não alcançavam.

## O que foi entregue

**Agenda operada pela IA.** O backend do Google já existia inteiro — OAuth com
PKCE, renovação de token, freeBusy, Meet, Tasks, sincronização incremental — e
nunca tinha sido ligado. O que faltava era um caminho para alguém além da página
pública usá-lo. A composição que decide um horário foi extraída para
`booking-service.server.ts`, e agora a página pública, a IA e o Inbox são três
chamadores do mesmo serviço.

**Ferramentas de agenda para o agente.** Consultar horários, marcar, remarcar,
cancelar e listar a próxima reunião, nos dois provedores.

**Inbox redesenhado.** Tela cheia, régua de leitura nas mensagens e agendamento
dentro da conversa.

**Captação.** Perguntas prontas no direct e QR code dos links.

## As duas regras que sustentam a segurança da IA

**O modelo escolhe o quê, nunca de quem.** Nenhuma ferramenta aceita
identificador de contato, workspace ou agendamento. Esses valores vêm da
conversa, que é confiável, e são injetados por cima dos argumentos. Não existe
frase que o lead possa escrever para fazer a IA mexer na agenda de outra pessoa:
o modelo não tem onde colocar o alvo. Um teste trava a invariante.

**Copiloto não executa.** No modo copiloto a IA escreve um rascunho para revisão.
Se pudesse chamar `agendar_reuniao`, a reunião entraria na agenda no instante em
que o rascunho fosse gerado — mesmo que o operador o descartasse. O copiloto
recebe só as ferramentas de leitura.

As ferramentas só ligam quando o operador vincula uma agenda ao agente. Ligá-las
por existir uma agenda no workspace faria uma IA começar a marcar reuniões reais
sem ninguém ter pedido.

---

## Os defeitos, e onde eles moravam

Cinco apareceram testando em produção, treze numa revisão de código. A coluna que
importa é a última.

| Defeito                                                                          | Camada que pegaria  |
| -------------------------------------------------------------------------------- | ------------------- |
| Regex acima de 255 na migration — nenhum link de captação jamais pôde ser criado | Contrato de banco   |
| Relação ambígua no PostgREST — cancelar agendamento nunca funcionou              | Contrato de banco   |
| `ilike` em e-mail trata `_` como curinga e acha o contato errado                 | Contrato de banco   |
| Resposta HTML aceita como sucesso pelo cliente                                   | Rota HTTP           |
| Método não implementado devolve 200 em vez de 405                                | Rota HTTP           |
| `startAt` comparado como texto recusa ISO com deslocamento                       | Rota HTTP           |
| Link do Meet exibido sem ter sido gravado                                        | Rota HTTP           |
| GET de agendamento sem limite de taxa                                            | Rota HTTP           |
| Contato órfão quando a reserva perde a corrida                                   | Rota HTTP           |
| Painel de agenda mantém nome e e-mail ao trocar de conversa                      | Componente          |
| Tokens contados só da última rodada de ferramenta                                | Costura de provedor |
| Esgotar o teto de rodadas devolve erro ao cliente                                | Costura de provedor |
| Queda do Redis soma dois segundos a cada requisição                              | Costura de provedor |
| 503 na primeira chamada depois de cada deploy                                    | Costura de provedor |
| IA prometeu convite que não foi enviado                                          | Função pura ✓       |
| Horário sem fuso viraria reserva três horas fora                                 | Função pura ✓       |
| `DEMO_MODE` em branco liga o modo demo                                           | Função pura ✓       |
| Ramo de erro inalcançável no `apiFetchText`                                      | Função pura ✓       |

A suíte cobre só a última linha. Zero testes de rota, zero de componente, zero
contra banco — e é exatamente aí que os defeitos deste produto moram, porque ele
é feito de integrações.

### Três que merecem explicação

**O motor de regex do Postgres recusa repetição acima de 255.** A restrição
`ref ~ '^[A-Za-z0-9_=-]{1,2083}$'` só é compilada quando alguém insere: a tabela
nasce sem reclamar e todo `insert` morre depois. O 2083 veio do limite de URL e
fazia sentido como número. Hoje o auditor recusa qualquer migration com esse
padrão.

**Duas chaves estrangeiras entre as mesmas tabelas tornam o embed ambíguo.**
`bookings` aponta para `calendar_events` e o evento aponta de volta. Pedir a
relação sem nomear a chave faz o PostgREST recusar a consulta inteira. Cancelar
agendamento devolvia 500 desde que a rota foi escrita.

**Uma rota chamada com método que não implementa devolve a página HTML com 200.**
O `apiFetch` fazia `response.json().catch(() => null)`, via o status ok e
devolvia `null` como se fosse o dado. Quem chamou seguia convencido de que a
escrita aconteceu. Aconteceu duas vezes num único dia.

---

## O teste que travava o erro

Em `env-blank.test.ts` havia esta asserção:

```ts
process.env.APP_ORIGIN = ''
expect(getServerEnv().APP_ORIGIN).toBe('http://localhost:3000')
```

O teste passava. E o que ele protegia era um comportamento que, em produção,
quebra todo redirecionamento de OAuth em silêncio.

É o modo de falha próprio de testar: **a cobertura subiu e a segurança caiu.** A
defesa não é escrever mais testes — é escrever a asserção a partir do que o
sistema precisa fazer, não do que o código faz hoje. Para variável de ambiente,
isso significa perguntar o que acontece em produção se alguém apagar o valor.
Para `APP_ORIGIN` e `DEMO_MODE`, a resposta certa é falhar alto, e agora é o que
acontece: linha ausente cai no padrão, linha em branco para o boot.

---

## Higienização

Removido o que não tinha nenhum uso: `src/lib/demo-data.ts` inteiro, os
componentes `PrototypeNotice` e `EmptyState`, três funções órfãs, a dependência
`@dnd-kit/sortable` e duas tabelas de um motor de regras que o DAG substituiu.
Saldo de 375 linhas a menos.

**O Tailwind ficou, de propósito.** Não há um único utilitário em uso, mas o
`preflight` dele é o reset sobre o qual todo o CSS foi escrito. Removê-lo trocaria
um ganho pequeno de bundle por risco visual em todas as telas. É peso morto aceito
conscientemente.

### A catraca de escritas sem verificação

O cliente do Supabase não lança: devolve `{ data, error }`. Uma escrita cujo
retorno é descartado falha em silêncio.

São 56 pontos assim. Nenhum produziu falha observada — verifiquei inscrições de
sequência, cooldowns e etiquetas, todos coerentes — e alguns são deliberados,
dentro de `catch`, onde relançar esconderia o erro original. Por isso o auditor
usa um **teto** em vez de exigir zero: a dívida fica visível, não cresce, e
baixá-la é um passo consciente.

Os três pontos onde a falha seria irrecuperável foram corrigidos: avanço de
posição da sequência, agendamento do passo seguinte e conclusão da inscrição. Sem
eles, uma sequência morre no meio ou é entregue de novo inteira, e não há erro
nenhum para investigar depois.

---

## Estado ao fim do dia

Release `20260830-revisao-v1`, 349 testes, auditor limpo, zero erro nos três
logs. Seis capacidades ligadas, incluindo `googleWorkspaceConfigured`.

Saíram do zero: CRM lead com log de auditoria, nota de conversa, etiqueta em
contato e base de conhecimento — esta última validada com a IA citando o preço
cadastrado e depois removida, porque o conteúdo era inventado para o teste.

### O que continua aberto

- **Credenciais no histórico público do Git.** Chave SSH e senhas administrativas.
  Redigir o arquivo não desfaz o que já foi publicado.
- **Sem teto de gasto de IA.** Sem linha em `ai_budgets` o código devolve limite
  zero e desliga a checagem. Com IA autônoma e envios externos ligados, é uma
  torneira aberta.
- **Sem backup automático.** Os backups existentes foram todos feitos à mão antes
  de cada deploy.
- **Conta não adicionada como usuário de teste no Google Cloud**, o que bloqueia a
  autorização da agenda.
- **Domínio próprio.** O `nip.io` passou no OAuth Client, mas não passa na
  verificação do Google — verificar exige provar propriedade, e o domínio não é
  seu. É pré-requisito de mercado, não preferência.
