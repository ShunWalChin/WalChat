# Auditoria e hardening do backend core — 20/08/2026

## Veredito

O core anterior era funcional para homologação inerte, mas não deveria operar contas reais sem correções: as APIs privadas usavam a service role como cliente de dados, a ingestão inbound podia parar no meio e não se reparar, o scheduler concluía silenciosamente tipos de job ainda não implementados e toda falha de envio Meta era marcada como ambígua.

Esta revisão corrige esses bloqueios e transforma o backend em **candidato a piloto controlado**. Isso não libera produção real automaticamente. `DEMO_MODE`, os kill switches por workspace, credenciais, App Review e os gates do runbook continuam obrigatórios.

## Escopo avaliado

- autenticação, autorização, tenancy, RLS e GRANTs;
- rotas HTTP, CSRF, limites de corpo, rate limiting e erros;
- webhook Meta, persistência, BullMQ e reconciliação;
- normalização inbound, gatilhos, cooldown e opt-out;
- scheduler, locks, retries e idempotência de entrega;
- OAuth Meta, tokens, criptografia e auditoria;
- OpenAI/Gemini, RAG, prompt injection, custo e papéis;
- exclusão de dados Meta;
- runtime Node, Nginx, Docker e logs;
- migrations, testes e procedimentos de promoção.

## Riscos críticos encontrados e tratamento

| Risco anterior                                                     | Severidade | Correção aplicada                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Service role usada como cliente normal das APIs privadas           | Crítica    | Contexto agora separa cliente JWT sujeito a RLS de `admin`, usado somente após RBAC explícito                                                                      |
| `workspace_members` permitia escrita direta por admin              | Crítica    | Escrita autenticada revogada; elimina promoção direta de admin para owner                                                                                          |
| Viewer/membro podia escrever em tabelas operacionais via PostgREST | Crítica    | Policies genéricas removidas e DML revogado em contatos, mensagens, jobs, entregas, runtime e auditoria                                                            |
| Inbound gravado em várias operações não transacionais              | Crítica    | RPC `ingest_instagram_inbound` grava/repara contato, interação, conversa e mensagem numa transação                                                                 |
| Retry de evento parcial retornava cedo                             | Alta       | Duplicatas agora reparam dados faltantes; automação retoma somente do estado `matched`                                                                             |
| Contador de não lidas sofria lost update                           | Alta       | Incremento atômico dentro da RPC PostgreSQL                                                                                                                        |
| Scheduler fazia select/update separado                             | Alta       | Claim transacional com `FOR UPDATE SKIP LOCKED`                                                                                                                    |
| Kind não implementado era marcado como concluído                   | Crítica    | Dispatcher recusa explicitamente e registra falha terminal sanitizada                                                                                              |
| Processo encerrado deixava jobs em `processing`                    | Alta       | Sweep recupera locks; claims externos antigos viram `unknown` antes do retry                                                                                       |
| HTTP 4xx/5xx da Meta virava estado ambíguo                         | Alta       | Rejeição confirmada vira `failed`; somente timeout/rede vira `unknown`                                                                                             |
| Private Reply ambígua virava `failed`                              | Crítica    | Estado `unknown` preservado e retry automático proibido                                                                                                            |
| Dedupe dependia do fluxo de aplicação                              | Alta       | `dedupe_key` e índices únicos persistentes em jobs/enrollments                                                                                                     |
| Ciphertext podia ser movido entre tenants/escopos                  | Alta       | AES-GCM v2 usa AAD de workspace/provider/tipo/escopo e migração preguiçosa de v1                                                                                   |
| OAuth concluía após remoção do papel do usuário                    | Alta       | Membership owner/admin é revalidada ao consumir o state                                                                                                            |
| Conta ficava `connected` antes de token/webhook consistentes       | Alta       | Fluxo salva token, confirma `subscribed_apps` e só então ativa                                                                                                     |
| Sugestão aceitava histórico fabricado pelo navegador               | Alta       | Inbox envia `conversationId`; backend carrega mensagens sob RLS                                                                                                    |
| Viewer podia gerar custo de IA                                     | Média      | IA restrita a owner/admin/agent; playground bruto fica vedado ao agent                                                                                             |
| Base RAG usava delimitadores com texto externo                     | Alta       | Documentos são serializados como JSON-dado e tratados como não confiáveis                                                                                          |
| Sem limite distribuído de IA/envio/OAuth                           | Alta       | Rate limiting Redis por usuário/workspace, com falha fechada em live                                                                                               |
| Corpos HTTP eram lidos sem limite                                  | Alta       | JSON 256 KiB, webhook 1 MiB e exclusão 32 KiB com leitura streaming                                                                                                |
| Callback de exclusão só gerava protocolo                           | Crítica    | Signed request valida algoritmo/HMAC; RPC remove conta, contatos, tokens, interações, jobs, payloads e auditorias vinculadas, desativa envios e expõe status opaco |
| Host encaminhado influenciava URL canônica                         | Alta       | Runtime usa somente `APP_ORIGIN`; Nginx sobrescreve forwarded headers                                                                                              |
| Containers sem limites/log rotation                                | Média      | CPU, memória, PIDs, grace period e rotação adicionados                                                                                                             |

## Modelo de autorização após a revisão

1. O bearer é validado no Supabase Auth.
2. Um cliente com a publishable key e o JWT consulta membership sob RLS.
3. Se houver mais de um workspace, `X-Workspace-Id` passa a ser obrigatório.
4. Leitura e configuração permitidas usam o cliente RLS.
5. Escritas operacionais usam `admin` somente dentro de uma rota já autenticada, com papel e tenant validados.
6. Workers continuam com service role porque não representam um usuário final.

Não criar novas rotas usando `context.admin` para consultas ou mutações genéricas. Seu uso exige filtro de `workspace_id`, validação de papel e teste de isolamento.

## Estados de entrega

| Estado    | Significado                                   | Retry automático                      |
| --------- | --------------------------------------------- | ------------------------------------- |
| `claimed` | intenção persistida antes da rede             | não enquanto em andamento             |
| `sent`    | resposta de sucesso confirmada                | replay local, sem nova chamada        |
| `blocked` | compliance recusou antes da rede              | não                                   |
| `failed`  | Meta respondeu com rejeição definida          | não; corrigir causa e usar nova chave |
| `unknown` | timeout, reset ou queda sem resposta definida | nunca; conciliação humana obrigatória |

## Migration

Arquivos:

- `supabase/migrations/20260820180000_backend_core_hardening.sql`;
- `supabase/migrations/20260820183000_backend_core_hotfix.sql`;
- `supabase/migrations/20260820184500_data_deletion_cleanup.sql`.

Principais mudanças:

- status `failed`/`unknown` explícitos;
- dedupe de enrollments e jobs;
- claim `SKIP LOCKED`;
- ingestão inbound transacional;
- cadastro de workspace mais resiliente;
- revogação de policies e GRANTs excessivos;
- exclusão de dados transacional e sem PII persistida.

A terceira migration amplia a exclusão para referências `ON DELETE SET NULL` e
campos JSON, evitando que payloads de webhook, interações, jobs ou auditorias
continuem armazenando dados do titular depois da remoção relacional.

Antes de aplicar: backup lógico, snapshot/backup do volume e conferência de `DEMO_MODE=true`. Depois: lint SQL, testes RLS com dois tenants, smoke autenticado e inspeção dos jobs/entregas.

## Evidências exigidas

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev
npm run validate:routes
```

No banco real:

- viewer não insere/atualiza tabelas de operação;
- admin não altera `workspace_members` diretamente;
- JWT do tenant A não lê tenant B;
- RPC inbound duplicada produz uma interação/mensagem e um incremento;
- dois schedulers não reivindicam o mesmo job;
- status de exclusão não revela `user_id`.

## Riscos residuais e próximos gates

- A instalação self-hosted inspecionada aparenta usar um segredo JWT de exemplo/padrão. A rotação coordenada em Auth, REST, Storage e consumidores, com emissão de novas chaves e invalidação das sessões antigas, é bloqueio obrigatório antes de usuários ou contas reais.
- CSP ainda permite script/style inline por compatibilidade com hidratação; migrar para nonce por request antes de uma política CSP estrita.
- `unknown` exige tela e runbook de conciliação com operador; não existe confirmação universal de entrega para todos os erros Meta.
- campanhas, publicação, insights e auto-like ainda não têm executores de produção; o scheduler agora falha esses kinds em vez de fingir sucesso.
- modo autônomo deve continuar desligado no primeiro piloto, mesmo com rate limit.
- SMTP, alertas externos, restore ensaiado, domínio definitivo, LGPD jurídico e App Review continuam gates externos.
- testes com conta Instagram Professional real são indispensáveis; mocks não comprovam permissões, subscriptions ou comportamento da Graph API.

## Decisão de promoção

O código pode ser publicado e implantado em homologação com `DEMO_MODE=true`. A mudança para piloto real somente ocorre após todos os gates de `docs/VALIDACAO_PRODUCAO_REAL_V1.md`, com uma conta controlada, kill switches inicialmente desligados e aprovação humana registrada.
