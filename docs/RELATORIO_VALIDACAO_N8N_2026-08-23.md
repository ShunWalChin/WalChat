# Relatório de validação — Wizard e integração n8n

Data: 23 de agosto de 2026  
Commit publicado: `05de829c7f2b63dfbaf5f4c70505cdbc44dd89ae`

## Resultado executivo

O conector n8n e o wizard central de integrações estão implementados,
documentados, validados e publicados em produção. As migrations do motor DAG e
do n8n passaram primeiro em um banco temporário criado a partir do esquema de
produção e depois foram aplicadas transacionalmente no banco ativo.

A release `20260823-n8n-wizard-v1` está ativa, com os quatro serviços saudáveis,
smokes públicos e autenticados aprovados e todos os kill switches de envio real
desligados. A versão anterior e o backup pré-migration foram preservados para
rollback.

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
| Migrations em produção       | 2 versões aplicadas e registradas                 |
| Smoke autenticado de módulos | integrações, CRM, inbox, IA e observabilidade OK  |
| Smoke de workers/webhooks    | Meta, WhatsApp, BullMQ e scheduler aprovados      |
| Auditoria pós-deploy         | RLS, triggers, logs e containers aprovados        |
| QA público em produção       | HTTPS, console limpo e sem overflow               |

O ensaio confirmou `automation_executions`, `integration_connections`,
`integration_webhook_deliveries`, quatro triggers de eventos n8n e a nova
constraint de tipos da fila.

## Estado seguro de produção

- URL: `https://wal-chat.64.181.178.125.nip.io`;
- release ativa:
  `/opt/wal-chat/releases/20260823-n8n-wizard-v1`;
- app, webhooks, scheduler e Redis estão saudáveis;
- disparos externos, Comment-to-DM e IA autônoma permanecem desligados;
- backup anterior à migration:
  `/opt/wal-chat/backups/20260823-n8n-wizard-v1/postgres-before.dump`;
- dump custom validado com `pg_restore --list` e SHA-256 registrado no servidor;
- imagem anterior preservada:
  `wal-chat-app:rollback-20260820-security-seo-v1`.

## Deploy concluído

A publicação seguiu os seguintes gates:

1. backup pré-migration criado e restaurabilidade validada;
2. `20260822010000_automation_dag_core.sql` aplicada em transação;
3. `20260822020000_n8n_integration_core.sql` aplicada em transação;
4. duas versões registradas em `supabase_migrations.schema_migrations`;
5. imagem de rollback da release anterior preservada;
6. nova imagem construída e os quatro serviços recriados;
7. health e readiness aprovados;
8. smokes público, autenticado, webhooks, workers e scheduler aprovados;
9. RLS, triggers, kill switches e ausência de erros críticos confirmados;
10. QA público em navegador concluído sem erros no console ou overflow.

## Limites conhecidos

O Wal Chat ainda não possui paridade total com o ManyChat. Sequências conserva
uma interface demonstrativa e Publicar, Reengajamento, Auto-like e Insights
permanecem bloqueados para execução real. A matriz completa está em
[`PARIDADE_MANYCHAT_2026-08-22.md`](./PARIDADE_MANYCHAT_2026-08-22.md).

Também faltam credenciais reais de Meta e OpenAI no ambiente inspecionado. O
wizard está pronto para recebê-las, mas o E2E com redes reais depende de App
Review, permissões, tokens e uma instância n8n fornecida pelo operador.

O build em produção emitiu um aviso não bloqueante para um chunk cliente de
aproximadamente 520 kB. A divisão adicional desse bundle fica registrada como
otimização de desempenho, sem impacto no gate funcional desta release.

## Segurança pós-deploy

Durante a inspeção operacional, valores do arquivo de ambiente apareceram no
log privado da tarefa por um erro de redaction do comando. Eles não foram
gravados no repositório. Como precaução, devem ser rotacionados após a janela de
deploy: service role do Supabase, segredos Meta/webhook, senha de smoke e chave
do cofre. A chave do cofre só pode ser trocada com recriptografia coordenada das
credenciais já persistidas.
