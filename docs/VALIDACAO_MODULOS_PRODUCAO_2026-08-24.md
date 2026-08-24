# Validação dos módulos de produção — 24/08/2026

## Parecer executivo

A release `20260824-production-modules-v2` está implantada e saudável em
<https://wal-chat.64.181.178.125.nip.io>. O backend, o worker de webhooks, o
scheduler e o Redis estão operacionais. O ambiente está **apto para testes
práticos internos** de CRM, Inbox, sequências, campanhas em rascunho, conteúdo,
calendário, automações, agentes, insights e integrações.

O ambiente permanece intencionalmente em `DEMO_MODE=true`. Portanto, ainda é
**NO-GO para disparos externos irrestritos** até concluir as aprovações e
credenciais externas descritas neste documento. O bloqueio é uma proteção de
produção, não uma limitação de interface.

## Release e recuperação

| Item                 | Valor                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| Release ativa        | `/opt/wal-chat/releases/20260824-production-modules-v2`                     |
| Commit funcional     | `a897e8f`                                                                   |
| Commit de testes     | `f33f942`                                                                   |
| Imagem de rollback   | `wal-chat-app:rollback-20260824-meta-instagram-fix-v1`                      |
| Backup pré-migration | `/opt/wal-chat/backups/20260824-production-modules-v1/postgres-before.dump` |
| SHA-256 do backup    | `1c422162efb8b16c6b2092bbe11287a4e529c06d24be99d7ca46928fc8b57079`          |

O banco temporário `wal_chat_check_20260824_121100`, criado exclusivamente para
ensaiar as migrations, foi removido após a validação. O backup de produção foi
preservado.

## Migrations aplicadas

- `20260824220000_sequence_delay_enum.sql`
- `20260824220100_production_modules.sql`

As duas migrations foram executadas primeiro em banco isolado e depois em uma
transação na instância real. O script
`scripts/validate-production-modules.sql` validou enums, RLS, GRANTs, RPCs
transacionais, enfileiramento atômico e o bloqueio de capacidades não
suportadas. A validação terminou em `ROLLBACK`, sem deixar dados de QA.

## Matriz funcional

| Módulo                      | Estado                         | O que foi validado                                                       |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| Autenticação e multi-tenant | Apto                           | JWT, workspace, RLS e APIs autenticadas                                  |
| Dashboard                   | Apto                           | Métricas persistidas e leitura por workspace                             |
| Inbox                       | Apto                           | Abas, atribuição, prioridade, notas, tags, mídia e envio pelo gateway    |
| Contatos e Tags             | Apto                           | CRUD, perfil 360º, filtros, lote, score, campos, notas e CSV             |
| Gatilhos                    | Apto                           | Comentário, DM, story e WhatsApp; resposta, sequência ou automação       |
| Sequências                  | Apto                           | Texto, mídia, typing, delay, ordenação, validação e ativação             |
| Automações DAG              | Apto                           | Versões, condições, ações, delay, A/B e auditoria                        |
| Agentes de IA               | Apto com credencial            | Personas, conhecimento, copiloto/autônomo e playground                   |
| Reengajamento               | Apto com gate                  | Preview, elegibilidade, rascunho, início, pausa/cancelamento e 30–45/min |
| Calendário                  | Apto localmente                | Mês/semana/agenda, CRUD, tarefas, bookings e integração transversal      |
| Google Calendar/Meet/Tasks  | Implementado, pendente         | Aguarda OAuth Client e consentimento da conta real                       |
| Publicação                  | Apto com gate                  | Feed, Reel, Story, Carrossel, agendamento, containers e worker           |
| Insights                    | Apto com conta                 | Sincronização resiliente de métricas oficiais e análise                  |
| Meta Instagram              | Conectado                      | Conta atualmente registrada: `@walfredonetto`                            |
| WhatsApp Cloud API          | Backend pronto, ativo pendente | Embedded Signup configurado; falta WABA/número real homologado           |
| n8n                         | Apto                           | API key, HMAC, inbox/outbox idempotente e ações controladas              |
| Auto-like                   | Não oferecido pela API oficial | Preferência pode ser salva, mas a execução permanece desabilitada        |
| Compliance                  | Apto                           | Janela de 24h, HUMAN_AGENT, opt-out, cooldown, blocklist e elegibilidade |

## Qualidade e segurança

| Verificação              | Resultado                                                                        |
| ------------------------ | -------------------------------------------------------------------------------- |
| ESLint                   | Aprovado                                                                         |
| Testes automatizados     | 28 arquivos e 97 testes aprovados                                                |
| Build Vite cliente + SSR | Aprovado                                                                         |
| Auditoria estrutural     | 59 APIs; zero gaps ou módulos demonstrativos detectados                          |
| Dependências de produção | Zero vulnerabilidades conhecidas no `npm audit --omit=dev`                       |
| Smoke público            | 21 rotas, 404, robots, sitemap e health aprovados                                |
| Smoke autenticado        | Todos os módulos e integrações principais aprovados                              |
| Webhooks                 | Verify Instagram/WhatsApp, HMAC inválido/rejeitado, HMAC válido/BullMQ aprovados |
| Serviços                 | App, webhooks, scheduler e Redis saudáveis                                       |
| Readiness HTTPS          | `ok=true`, Supabase e Redis ativos                                               |

## Inspeção dos botões no Chrome

As rotas Sequências, Reengajamento, Publicar, Auto-like, Insights, Inbox,
Gatilhos, Configurações, Integrações e Operação foram abertas em sessão
autenticada. Não foram encontrados botões de fachada ou links `href="#"`.

Os controles desabilitados observados são condicionais e explicáveis:

- `Salvar`, `Agendar` e `Publicar agora`: aguardam conteúdo/formulário válido;
- `Iniciar campanha`: exige campanha salva e preview de elegibilidade;
- `Configure um agente`: exige um agente de IA selecionado/configurado;
- `Adicionar nota`: exige uma conversa/contato selecionado;
- `Salvar e validar API`: exige os dados da integração escolhida;
- `Ativar produção`: exige todos os gates externos e kill switches aprovados.

Os erros de console capturados durante o percurso vieram de extensões do Chrome,
não de arquivos ou requisições do domínio Wal Chat.

## Estado real das integrações

O endpoint `/api/ready` confirma:

- Meta configurada;
- Instagram configurado;
- Embedded Signup do WhatsApp configurado;
- criptografia de credenciais configurada;
- OpenAI e Gemini ainda sem credenciais;
- Google Workspace ainda sem credenciais.

Configuração de backend não equivale à homologação do ativo externo. Antes de
enviar para contatos reais, é obrigatório confirmar no próprio provedor o app,
o ativo, as permissões, o consentimento e um teste controlado ponta a ponta.

## Bloqueadores para o Go-Live externo

1. Concluir verificação empresarial, publicação do app e Advanced Access no
   painel da Meta.
2. Confirmar a conta Instagram piloto pretendida. A produção ainda aponta para
   `@walfredonetto`; a troca para `_fat.tech` não foi concluída.
3. Vincular e homologar WABA e telefone reais, sincronizar templates e testar
   envio/receipt com um número piloto.
4. Configurar `OPENAI_API_KEY` ou Gemini e validar custo, limites e política dos
   agentes antes de liberar modo autônomo.
5. Configurar OAuth do Google, executar consentimento e testar Calendar, Meet,
   Tasks e Free/Busy com a conta piloto.
6. Configurar SMTP de produção, monitoramento/alertas e política de backup
   recorrente.
7. Executar o piloto de baixo volume e somente então desligar `DEMO_MODE` e
   liberar os kill switches necessários.

## Sequência segura de testes práticos

1. Testar CRM, tags, Inbox, calendário local, gatilhos e sequências sem envio
   externo.
2. Conectar a conta piloto e validar webhooks recebidos.
3. Liberar um único canal e um único contato de teste.
4. Verificar janela de 24h, opt-out, cooldown, idempotência e registro de
   auditoria.
5. Testar Comment-to-DM com uma publicação piloto e uma única resposta privada.
6. Testar WhatsApp com template aprovado e número de QA.
7. Testar publicação como rascunho/agendamento antes de `Publicar agora`.
8. Acompanhar Central de Go-Live, fila, falhas e receipts durante todo o piloto.

## Decisão

- **GO:** testes internos completos e piloto controlado sem efeitos externos
  não autorizados.
- **NO-GO:** disparos em massa, IA autônoma, publicação irrestrita e promoção
  geral enquanto os bloqueadores externos não forem concluídos.
