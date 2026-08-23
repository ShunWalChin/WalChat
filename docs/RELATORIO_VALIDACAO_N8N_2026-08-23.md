# Relatório de validação — Wizard e integração n8n

Data: 23 de agosto de 2026  
Commit validado: `975bee65e6353f181eb94ad643371c74ededd267`

## Resultado executivo

O conector n8n e o wizard central de integrações estão implementados,
documentados e aprovados nas validações locais. As migrations do motor DAG e
do n8n também passaram em um banco temporário criado a partir do esquema de
produção.

A release de produção **não foi trocada nesta execução**. O histórico da tarefa
continha instruções conflitantes sobre deploy e a autorização de mutation do
banco foi recusada de forma segura. A release ativa continua sendo
`20260820-security-seo-v1`.

## Escopo entregue

- wizard central para Instagram, WhatsApp, Google Workspace, IA e n8n;
- validação da API pública do n8n por API key;
- saída Wal Chat → n8n com HMAC SHA-256 e fila durável;
- entrada n8n → Wal Chat com HMAC, anti-replay e inbox idempotente;
- ações inbound restritas a contato, tag e automação publicada;
- defesa contra SSRF, timeout, redirect e redes privadas por padrão;
- rastreabilidade de entregas e vínculo de identidade externa do CRM;
- contrato JSON Schema v1 e manual operacional.

## Evidências de validação

| Verificação                  | Resultado                                         |
| ---------------------------- | ------------------------------------------------- |
| TypeScript `tsc --noEmit`    | aprovado                                          |
| ESLint                       | aprovado                                          |
| Vitest                       | 25 arquivos, 89 testes aprovados                  |
| Testes focados n8n/scheduler | 14 testes aprovados                               |
| Build Vite cliente + SSR     | aprovado                                          |
| `npm audit --omit=dev`       | 0 vulnerabilidades                                |
| Auditoria de APIs            | 54 arquivos, 0 achados                            |
| Smoke SSR/HTTP               | 21 rotas, 404, robots, sitemap e health aprovados |
| Autorização da API n8n       | resposta `401` sem sessão                         |
| QA visual desktop            | 1440 × 900 aprovado                               |
| QA visual mobile             | 375 × 812, sem overflow, aprovado                 |
| Ensaio de migrations         | aprovado em banco temporário isolado              |

O ensaio confirmou `automation_executions`, `integration_connections`,
`integration_webhook_deliveries`, quatro triggers de eventos n8n e a nova
constraint de tipos da fila.

## Estado seguro de produção

- URL: `https://wal-chat.64.181.178.125.nip.io`;
- containers atuais estavam saudáveis na inspeção;
- disparos externos, Comment-to-DM e IA autônoma estavam desligados;
- backup anterior à migration:
  `/opt/wal-chat/backups/20260823-n8n-wizard-v1/postgres-before.dump`;
- dump custom validado com `pg_restore --list` e SHA-256 registrado no servidor;
- release candidata, ainda inativa:
  `/opt/wal-chat/releases/20260823-n8n-wizard-v1`.

## Gate para concluir o deploy

É necessária uma confirmação nova e explícita para alterar produção. Depois da
aprovação, a sequência é:

1. aplicar `20260822010000_automation_dag_core.sql` em transação;
2. aplicar `20260822020000_n8n_integration_core.sql` em transação;
3. registrar as duas versões em `supabase_migrations.schema_migrations`;
4. copiar o `.env.production` sem imprimir seus valores;
5. construir e subir a release candidata com Docker Compose;
6. aguardar health de app, webhooks, scheduler e Redis;
7. executar smoke público e autenticado com kill switches desligados;
8. voltar imediatamente à release anterior se qualquer gate falhar.

## Limites conhecidos

O Wal Chat ainda não possui paridade total com o ManyChat. Sequências conserva
uma interface demonstrativa e Publicar, Reengajamento, Auto-like e Insights
permanecem bloqueados para execução real. A matriz completa está em
[`PARIDADE_MANYCHAT_2026-08-22.md`](./PARIDADE_MANYCHAT_2026-08-22.md).

Também faltam credenciais reais de Meta e OpenAI no ambiente inspecionado. O
wizard está pronto para recebê-las, mas o E2E com redes reais depende de App
Review, permissões, tokens e uma instância n8n fornecida pelo operador.

## Segurança pós-deploy

Durante a inspeção operacional, valores do arquivo de ambiente apareceram no
log privado da tarefa por um erro de redaction do comando. Eles não foram
gravados no repositório. Como precaução, devem ser rotacionados após a janela de
deploy: service role do Supabase, segredos Meta/webhook, senha de smoke e chave
do cofre. A chave do cofre só pode ser trocada com recriptografia coordenada das
credenciais já persistidas.
