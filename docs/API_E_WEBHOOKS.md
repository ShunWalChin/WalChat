# API e webhooks

Todos os exemplos usam `https://wal-chat.64.181.178.125.nip.io`. Em desenvolvimento, substitua pela origem local.

## Convenções

- JSON usa `Content-Type: application/json`.
- Respostas operacionais desabilitam cache com `Cache-Control: no-store`.
- Entradas internas são validadas com Zod.
- O webhook Meta valida a assinatura antes de interpretar o JSON.
- Erros esperados retornam mensagens curtas e não expõem stack traces ou secrets.

## `GET /api/health`

Liveness: indica somente se o processo HTTP está ativo. Não prova acesso a banco, fila ou serviços externos.

```json
{
  "ok": true,
  "service": "wal-chat",
  "status": "alive",
  "timestamp": "2026-07-21T15:57:11.664Z",
  "configuredIntegrations": {
    "supabase": true,
    "redis": true,
    "meta": true,
    "gemini": false
  },
  "mode": "demo",
  "readinessUrl": "/api/ready"
}
```

`configuredIntegrations` significa somente “variáveis presentes”; não representa conexão nem aprovação externa concluída.

## `GET /api/ready`

Readiness: executa sondagens curtas em Supabase e Redis. Retorna `200` quando o processo está apto a receber tráfego e `503` quando uma dependência configurada não responde ou uma dependência obrigatória está ausente em modo live.

```json
{
  "ok": true,
  "service": "wal-chat",
  "status": "ready",
  "mode": "live",
  "checks": {
    "supabase": { "status": "up" },
    "redis": { "status": "up" }
  },
  "capabilities": {
    "meta": true,
    "encryption": true,
    "openai": true,
    "gemini": false
  }
}
```

As razões de falha são sanitizadas e nunca incluem URL, credencial, token ou stack trace. O Compose de produção usa este endpoint no healthcheck da aplicação.

## `GET /api/public/webhooks/instagram`

Usado pela Meta para validar o callback.

Parâmetros:

| Campo              | Regra                                |
| ------------------ | ------------------------------------ |
| `hub.mode`         | Deve ser `subscribe`                 |
| `hub.verify_token` | Deve ser igual a `META_VERIFY_TOKEN` |
| `hub.challenge`    | É devolvido como texto puro          |

Respostas:

- `200`: challenge aceito;
- `403`: modo, token ou challenge inválido.

## `POST /api/public/webhooks/instagram`

Recebe eventos `messages`, `messaging_postbacks`, `comments`, `mentions` e `message_reactions`.

Header obrigatório:

```text
X-Hub-Signature-256: sha256=<hmac_hex_do_corpo_bruto>
```

Validação:

```text
HMAC-SHA256(META_APP_SECRET, rawBody)
```

O hash é comparado com `timingSafeEqual`. O corpo é parseado somente depois da validação.

Resposta aceita:

```json
{
  "received": true,
  "queued": "<hash-do-evento>",
  "backend": "bullmq"
}
```

Códigos:

- `200`: recebido, ignorado ou enfileirado;
- `400`: JSON inválido;
- `401`: assinatura inválida;
- `503`: segredo ausente ou fila temporariamente indisponível.

Em `503`, o endpoint envia `Retry-After: 10` para favorecer uma nova tentativa. Em live, Redis ausente falha fechado com `503`. Um reconciliador independente procura eventos persistidos que ficaram em `queued`, compara o estado do `jobId` no BullMQ e reenfileira somente quando o job canônico não existe.

## `GET/POST /api/public/webhooks/whatsapp`

Usa o mesmo challenge, Verify Token, HMAC SHA-256, limite de corpo, persistência idempotente e fila do webhook Instagram. O POST aceita somente o objeto `whatsapp_business_account`; o worker processa o campo `messages`, incluindo mensagens inbound e statuses de entrega.

- resolve o workspace pelo `phone_number_id` e confirma o `waba_id`;
- cria contato, interação, conversa e mensagem pela RPC `ingest_whatsapp_inbound`;
- atualiza `sent`, `delivered`, `read` e `failed` sem regressão de status;
- converte mídia em URL interna autenticada; o access token nunca chega ao browser;
- agenda gatilho/IA somente na primeira ingestão do evento.

## `POST /api/ai/suggest`

Gera uma sugestão curta em PT-BR usando o agente e a base persistidos no workspace. Exige JWT Supabase; persona e conhecimento enviados pelo navegador são ignorados por design.

Request:

```json
{
  "agentId": "00000000-0000-0000-0000-000000000000",
  "history": [{ "role": "user", "content": "Quero o guia" }]
}
```

Limites:

- `agentId`: UUID de um agente ativo do workspace;
- `history`: uma a cinco mensagens, até 4.000 caracteres cada.

Resposta:

```json
{
  "suggestion": "Fechou! Separei tudo por aqui 👊\n\nResponda PARAR",
  "provider": "openai",
  "model": "gpt-5.6-sol"
}
```

Códigos: `200`, `400`, `401`, `403`, `500` ou `502`.

## Integração Meta

| Método     | Endpoint                                         | Uso                                                                  |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `POST`     | `/api/integrations/meta/start`                   | Cria state de uso único, cookie HttpOnly e URL OAuth                 |
| `GET`      | `/api/integrations/meta/callback`                | Confere cookie/state, troca token, assina webhook e cifra credencial |
| `GET`      | `/api/integrations/meta/status`                  | Retorna configuração, URLs e contas sem expor secrets                |
| `POST`     | `/api/integrations/meta/validate`                | Relê perfil e `subscribed_apps`                                      |
| `DELETE`   | `/api/integrations/meta/disconnect`              | Desassina webhooks e remove token cifrado                            |
| `POST`     | `/api/integrations/meta/whatsapp/complete`       | Valida Embedded Signup, WABA, telefone e assinatura                  |
| `POST`     | `/api/integrations/meta/whatsapp/validate`       | Revalida token, scopes granulares, telefone e webhook                |
| `POST`     | `/api/integrations/meta/whatsapp/register`       | Registra telefone com PIN de seis dígitos efêmero                    |
| `GET/POST` | `/api/integrations/meta/whatsapp/templates`      | Lista cache e sincroniza templates da WABA                           |
| `GET`      | `/api/integrations/meta/whatsapp/media/:mediaId` | Proxy autenticado de mídia inbound                                   |

Mutações exigem `owner/admin`, bearer token e Origin confiável. O callback é público por protocolo, mas exige state simultaneamente no cookie e no Postgres.

## Configurações e agentes de IA

| Método                  | Endpoint            | Uso                                                 |
| ----------------------- | ------------------- | --------------------------------------------------- |
| `GET/PUT`               | `/api/ai/settings`  | Provedor, modelo, limites e API key cifrada         |
| `GET/POST/PATCH/DELETE` | `/api/ai/agents`    | CRUD de personas e modos                            |
| `GET/POST/PATCH/DELETE` | `/api/ai/knowledge` | CRUD da base textual, sempre filtrada por workspace |

Leitura exige associação ao workspace. Escrita exige `owner/admin`. A chave nunca é devolvida; o status informa apenas `configured` e a origem `tenant`, `server` ou `none`.

## Calendário e Google Workspace

| Método                  | Endpoint                              | Uso                                       |
| ----------------------- | ------------------------------------- | ----------------------------------------- |
| `GET/POST/PATCH/DELETE` | `/api/calendar`                       | Feed temporal e CRUD de eventos/tarefas   |
| `GET/POST/PATCH/DELETE` | `/api/calendar/booking-pages`         | Tipos públicos de reunião                 |
| `PATCH`                 | `/api/calendar/bookings`              | Confirmar, concluir, cancelar ou no-show  |
| `POST`                  | `/api/integrations/google/start`      | State, PKCE, cookies HttpOnly e URL OAuth |
| `GET`                   | `/api/integrations/google/callback`   | Code exchange e tokens cifrados           |
| `GET/PATCH`             | `/api/integrations/google/status`     | Estado sanitizado e calendários/listas    |
| `POST`                  | `/api/integrations/google/sync`       | Sync incremental Calendar e Tasks         |
| `POST`                  | `/api/integrations/google/disconnect` | Remove access/refresh tokens locais       |
| `GET/POST`              | `/api/public/bookings/:slug`          | Disponibilidade e reserva transacional    |

As rotas privadas exigem JWT, workspace e origem confiável; `viewer` não pode
alterar agenda. O endpoint público não recebe identificadores internos nem
credenciais. A reserva POST recalcula o slot, consulta Free/Busy, usa lock
transacional e retorna `409` se outra requisição ocupou o intervalo.

Detalhes: [Google Calendar, Meet e Tasks](CONFIGURACAO_GOOGLE_CALENDAR.md).

## `POST /api/messages/send`

Envio manual autenticado por `owner/admin/agent`. Recebe `contactId`, `message` e `humanAgent`; para WhatsApp fora de 24h, recebe um template já sincronizado (`name`, `language`, `components`). O backend relê contato, canal e blocklist, aplica compliance, usa o token da conta do mesmo workspace e persiste sucessos e bloqueios.

Header obrigatório:

```text
Idempotency-Key: manual:<uuid>
```

A chave deve ter de 16 a 128 caracteres e usar somente letras, números, `.`, `_`, `:` ou `-`. O cliente conserva a mesma chave quando uma tentativa falha de forma ambígua. O backend cria o claim em `outbound_deliveries` antes da chamada externa:

- uma entrega `sent` ou `blocked` é reproduzida sem chamar a Meta novamente;
- a mesma chave com payload diferente retorna `409 idempotency_conflict`;
- estados `claimed` e `unknown` retornam `409`, bloqueando retry automático;
- chave ausente ou inválida retorna `400`.

A resposta de sucesso inclui `replayed`, que informa se o resultado foi lido do claim persistido.

## CRM de Contatos & Tags

- `GET /api/contacts`: lista paginada com busca, canal, elegibilidade, estágio,
  tag, responsável, arquivo e ordenação; retorna resumo e permissões do papel.
- `POST /api/contacts`: cria contato manual sem identidade Meta e sem
  elegibilidade para disparos; exige `owner/admin/agent`.
- `GET/PATCH /api/contacts/:id`: perfil 360º, campos personalizados e
  atualização dos dados CRM sem sobrescrever a identidade sincronizada da Meta.
- `PATCH /api/contacts/bulk`: tags, estágio, responsável, IA, opt-out, novo
  opt-in comprovado e arquivamento para até 100 contatos por operação.
- `POST/PATCH/DELETE /api/contacts/:id/notes`: notas internas com autoria,
  fixação e exclusão auditada.
- `GET/POST/PATCH/DELETE /api/contact-tags`: catálogo, contagem, edição e
  arquivamento reversível; criação e edição exigem `owner/admin`.

Todas as mutações validam origem, workspace, papel e IDs antes de usar a
service role. O opt-in restaurado exige confirmação e origem registradas.

## Inbox e gatilhos

- `GET /api/inbox`: lista até 100 conversas da categoria, contato sanitizado, janela calculada, até 200 mensagens e agentes ativos.
- `PATCH /api/inbox`: marca leitura e altera categoria/IA do contato; exige `owner/admin/agent`.
- `GET /api/triggers`: lista gatilhos e quantidade de contatos em cooldown.
- `POST/PATCH/DELETE /api/triggers`: cria, altera ou exclui gatilhos simples; exige `owner/admin`.

## `POST /api/compliance/check`

Expõe o motor puro de compliance para pré-visualização. O scheduler chama a mesma função no envio real.

Request mínimo:

```json
{
  "lastInboundAt": "2026-07-21T12:00:00.000Z",
  "isAutomated": true,
  "message": "Aqui está o material"
}
```

Resposta permitida:

```json
{
  "allowed": true,
  "policy": "standard_24h",
  "body": "Aqui está o material\n\nResponda PARAR",
  "secondsLeft24h": 81000
}
```

Motivos de bloqueio possíveis:

- `opted_out`;
- `no_inbound_interaction`;
- `outside_24h`;
- `outside_7d`;
- `human_agent_is_not_automation`;
- `trigger_cooldown`;
- `comment_already_replied`;
- `outside_private_reply_window`;
- `blocked_content`.

## `POST /api/data-deletion`

Implementa o callback de exclusão exigido pela Meta. Recebe `signed_request` como form data, valida HMAC com `META_APP_SECRET` e devolve URL/status de acompanhamento.

```json
{
  "url": "https://wal-chat.example/exclusao-de-dados?confirmation=<codigo>",
  "confirmation_code": "<codigo>"
}
```

O MVP gera o protocolo validado. A exclusão assíncrona das tabelas e arquivos deve ser conectada ao runbook operacional antes do Live Mode.

## Idempotência dos eventos

1. SHA-256 do corpo bruto gera `meta_event_key`.
2. `webhook_events.meta_event_key` é único.
3. BullMQ usa o mesmo valor como `jobId`.
4. Interações usam índice único parcial por `workspace_id` e `meta_event_id`.
5. Private Replies usam chave primária no ID do comentário.

Essas camadas protegem contra retries normais da Meta e concorrência entre workers.

## Idempotência dos envios

1. O chamador fornece uma chave estável por ação.
2. O backend calcula um fingerprint de workspace, conta, destinatário e decisão final de compliance.
3. `outbound_deliveries` possui unicidade em `(workspace_id, idempotency_key)`.
4. O claim é gravado antes da chamada à Graph API.
5. Sucesso e bloqueio podem ser reproduzidos; entrega ambígua nunca é reenviada automaticamente.
6. Scheduler usa `scheduled-job:<job-id>`; Inbox usa `manual:<uuid>`.

Private Reply mantém sua trava independente por ID de comentário, porque a Meta permite apenas uma resposta privada automática por comentário.

## Autenticação dos endpoints

O webhook e a exclusão são públicos por definição do protocolo, mas autenticados por assinatura. Integrações, configurações/agentes de IA e envio manual exigem JWT Supabase e membership explícito. O preview de compliance é uma função pública sem persistência nem efeitos externos. O Nginx versionado aplica limites separados ao tráfego geral, webhook, OAuth e endpoints de envio/IA; a sintaxe e o comportamento `429` ainda devem ser validados na infraestrutura de destino.

## Endpoints operacionais V1

### `GET/PATCH /api/operations/go-live`

`GET` devolve checks sanitizados, resumo e estado dos três switches do workspace. `PATCH` exige `owner/admin`; para ligar `externalSendsEnabled`, exige a confirmação literal `ATIVAR PRODUCAO` e todos os checks críticos verdes. Desligar a chave principal também desliga Comment-to-DM e IA autônoma.

### `GET/POST /api/operations/webhooks`

`GET` lista até 100 eventos do workspace e contadores por estado, sem expor o payload bruto. `POST` reenfileira somente evento `failed`, exige `owner/admin` e registra auditoria.

### `GET/POST /api/integrations/meta/media`

`GET` retorna o cache das últimas publicações. `POST` exige `owner/admin`, usa o token cifrado da conta informada e atualiza `posts_cache` com os dados da Graph API.

### Extensões de Inbox, gatilhos e IA

- `/api/inbox`: atribuição, prioridade, status e notas internas; notas nunca são mensagens externas.
- `/api/triggers`: aceita `postId` e devolve métricas de `automation_runs`.
- `/api/ai/knowledge`: registra tipo, URL de origem, checksum, status e último uso.
- `/api/ai/suggest`: devolve a sugestão e as fontes recuperadas da base do tenant.

Veja os fluxos, gates e matriz de aceite em [Atualização operacional V1](ATUALIZACAO_OPERACIONAL_V1.md).
