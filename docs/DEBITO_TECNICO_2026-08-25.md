# Registro de débito técnico — 25/08/2026

Prioridade = (impacto + risco) × (6 − esforço), cada eixo de 1 a 5. A fórmula
favorece de propósito o que é barato: débito caro e de baixo risco não deve
competir com débito barato e perigoso.

## Ranking

| #   | Item                                           | Categoria      |   I |   R |   E | Prio |
| --- | ---------------------------------------------- | -------------- | --: | --: | --: | ---: |
| 01  | CI existe e nunca rodou                        | Infraestrutura |   4 |   4 |   1 |   40 |
| 02  | Não existe backup agendado                     | Infraestrutura |   2 |   5 |   1 |   35 |
| 03  | Deploy inteiramente manual                     | Infraestrutura |   4 |   4 |   2 |   32 |
| 04  | Zero observabilidade                           | Infraestrutura |   3 |   5 |   2 |   32 |
| 05  | `scheduler.worker.ts` sem teste                | Teste          |   3 |   5 |   3 |   24 |
| 06  | Cobertura não é medida                         | Teste          |   2 |   2 |   1 |   20 |
| 07  | Instagram e WhatsApp implementados em paralelo | Arquitetura    |   4 |   4 |   4 |   16 |
| 08  | 23 dependências atrasadas, 5 major             | Dependência    |   2 |   3 |   3 |   15 |
| 09  | `sequencias.tsx` com 2.667 linhas              | Código         |   3 |   2 |   3 |   15 |
| 10  | Nenhuma rota de API tem teste                  | Teste          |   3 |   4 |   4 |   14 |
| 11  | 17 documentos afirmam estado                   | Documentação   |   2 |   2 |   3 |   12 |
| 12  | Escalas de design definidas e não aplicadas    | Código         |   2 |   1 |   4 |    6 |
| 13  | Interface sem teste                            | Teste          |   2 |   3 |   5 |    5 |

**Os quatro primeiros são todos de infraestrutura, e os quatro são baratos.** O
código está em melhor estado que a operação em volta dele.

## Evidência de cada item

| Item | Medição                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 01   | Workflow escrito e verificado; push recusado por falta de escopo `workflow`         |
| 02   | `crontab -l` e `systemctl list-timers` sem entrada; todo backup é manual pré-deploy |
| 03   | Nenhum `scp`/`rsync`/`ssh` em `scripts/`, `deploy/` ou `.github/`                   |
| 04   | `package.json` sem APM, log agregado ou uptime                                      |
| 05   | 990 linhas; nenhum teste importa o módulo                                           |
| 06   | `@vitest/coverage-v8` ausente                                                       |
| 07   | 42% de similaridade entre os processadores, 37% entre os senders                    |
| 08   | `bullmq` 5→6, `ioredis` 5→6, `openai` 6→7, `typescript` 6→7, `lucide` 0.545→1.34    |
| 09   | Maior arquivo do projeto; `contatos` e `calendario` passam de 2.200                 |
| 10   | 10.277 linhas em 61 arquivos, zero exercitadas                                      |
| 11   | 33 docs, 6.823 linhas; o README tem 171 linhas de tabela declarando estado          |
| 12   | 1.762 regras com valores literais; 266 cores sem papel semântico                    |
| 13   | 16.156 linhas; `@testing-library/react` e `jsdom` instalados e sem uso              |

## Cobertura por camada

A métrica mede **módulos importados por algum teste** — é um teto generoso, não
cobertura de linha. O provider não está instalado (item 06).

| Camada                          | Linhas | Exercitadas | Teto |
| ------------------------------- | -----: | ----------: | ---: |
| Backend (`server/`, `workers/`) | 11.964 |       8.609 |  72% |
| Rotas de API                    | 10.277 |           0 |   0% |
| Interface                       | 16.156 |           0 |   0% |

## Plano em três fases

### Fase 1 — um dia, remove o risco operacional (itens 01–04)

- **Liberar o CI**: `gh auth refresh -s workflow` e push. O resto já está pronto.
- **Agendar o backup**: timer systemd diário chamando
  `scripts/ops/create-complete-backup.sh`, com retenção e um teste de restauração.
- **Script de deploy**: a sequência de 25/08 virando um comando, com o ensaio da
  migration e a checagem do `.env.production` embutidos.
- **Uptime e erro**: monitor externo em `/api/ready` e captura de exceção nos
  workers. Não precisa ser sofisticado; precisa existir.

### Fase 2 — junto com o produto (itens 05, 06, 08)

- Instalar a medição de cobertura e fixar um piso no CI.
- Testar o scheduler com o cliente falso já usado em `automation-reply.test.ts`.
- Subir dependências em duas levas: minors juntas, majors uma a uma.

### Fase 3 — quando houver folga (itens 07, 09–13)

- Unificar os canais extraindo o que os dois processadores já fazem igual.
- Quebrar os arquivos gigantes, começando pelo editor de automações.
- Contratos das rotas, priorizando as que já sofreram incidente.
- Docs e design por último.

## Antes de qualquer fase

Os três bugs corrigidos em `8988e39` **estão em produção**: o deploy de 25/08 foi
feito antes deles. São 62 commits locais aguardando publicação. Subir isso vem
antes de tudo que está neste registro.
