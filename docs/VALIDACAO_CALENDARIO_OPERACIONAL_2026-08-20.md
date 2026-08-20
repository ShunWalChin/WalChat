# Validação do calendário operacional — 2026-08-20

## Resultado

O core publicado está **aprovado para homologação**. A integração externa Google
permanece **pendente de credenciais e conta piloto**; nenhum teste desta rodada
inventou Client ID, Client Secret ou acesso a uma agenda real.

## Escopo entregue

- visualizações mês, semana e agenda com data real, filtros e navegação;
- eventos locais/Google, dia inteiro, convidados, local, contato e Meet;
- tarefas locais/Google com prazo, prioridade, estado e contato;
- drag-and-drop com alternativa de edição acessível;
- OAuth Google com state, PKCE, cookie HttpOnly e tokens cifrados;
- Calendar List, Events, Free/Busy, Tasks e sincronização incremental;
- sincronização automática pelo scheduler e sincronização manual;
- links públicos com dias/horários, fuso, buffer, antecedência e Meet;
- reserva e evento criados atomicamente, com lock, buffer e idempotência;
- link oficial propagado por gatilhos, sequências e agentes de IA;
- projeção temporal de conteúdo, campanhas, sequências, jobs e atividades;
- RLS, GRANTs, auditoria sanitizada e revogação/descarte de tokens.

## Evidências executadas

| Validação                                         | Resultado                                |
| ------------------------------------------------- | ---------------------------------------- |
| TypeScript (`npx tsc --noEmit`)                   | aprovado                                 |
| ESLint (`npm run lint`)                           | aprovado                                 |
| Vitest                                            | 22 arquivos e 67 testes aprovados        |
| Build cliente + SSR                               | aprovado                                 |
| Dependências de produção (`npm audit --omit=dev`) | 0 vulnerabilidades                       |
| Migration em clone isolado do schema de produção  | aprovada em transação única              |
| Reserva repetida com a mesma chave                | devolveu a mesma reserva                 |
| Reserva dentro do buffer de 15 minutos            | rejeitada                                |
| Reserva após o buffer                             | confirmada                               |
| Vínculo reserva-evento                            | 2 reservas e 2 eventos, ambos vinculados |

O smoke reproduzível está em `scripts/smoke-calendar-production.mjs`. Ele exige
`ALLOW_CALENDAR_SMOKE=true`, cria um tenant descartável e executa evento, tarefa,
página, reserva, replay idempotente, buffer e leitura unificada.

O banco temporário `wal_chat_calendar_migration_test` foi removido após as
asserções. A migration não foi testada diretamente sobre dados de produção
antes desse ensaio isolado.

## Publicação e smoke integrado

- URL: `https://wal-chat.64.181.178.125.nip.io`;
- release: `/opt/wal-chat/releases/20260820-operational-calendar-v1-2`;
- commit de código: `27a65bf`;
- migration: `20260820230000`, registrada no histórico do Supabase;
- backup anterior: `/opt/wal-chat/backups/20260820-before-calendar-269a50c.dump`;
- SHA-256 do backup:
  `7cb0effa339e8cc33fe94af4a1cdb46c3bc447e9ab758de2cf071593dc2332e6`.

App, worker de webhooks, scheduler e Redis ficaram saudáveis. O smoke dentro do
container publicado aprovou evento, tarefa, página, reserva, replay idempotente,
buffer simétrico, leitura unificada e status Google. O usuário/workspace de QA
foi removido; as seis tabelas do calendário voltaram a zero registros de teste.
As datas e horas da página pública são renderizadas no fuso configurado na
agenda, independentemente do fuso do navegador do lead.

No navegador, HTTPS e rota do calendário responderam `200`, endpoint privado
Google sem JWT respondeu `401`, slug público inexistente respondeu `404`, o
console ficou sem erros e a entrada em 390×844 não apresentou overflow
horizontal.

O ambiente continua em `DEMO_MODE=true`; Client ID/Secret Google, OpenAI/Gemini
e disparos externos não foram habilitados por esta entrega.

## Homologação externa obrigatória

Depois de configurar o Google Cloud conforme
[Configuração do Google Calendar](CONFIGURACAO_GOOGLE_CALENDAR.md), executar:

1. conectar e revogar uma conta piloto;
2. criar, editar e excluir evento com convidado;
3. criar Meet e abrir o link nas duas pontas;
4. criar, concluir e excluir tarefa;
5. alterar e excluir itens diretamente no Google e confirmar o sync automático;
6. reservar por link público e confirmar contato, booking, evento e convite;
7. disparar duas reservas concorrentes para o mesmo horário;
8. simular Free/Busy indisponível e confirmar falha fechada;
9. validar o link em gatilho, sequência e copiloto, preservando compliance Meta.

Somente após essa matriz a integração Google deve ser declarada homologada com
contas reais.
