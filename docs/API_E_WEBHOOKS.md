# API e webhooks

Todos os exemplos usam `https://wal-chat.64.181.178.125.nip.io`. Em desenvolvimento, substitua pela origem local.

## Convenções

- JSON usa `Content-Type: application/json`.
- Respostas operacionais desabilitam cache com `Cache-Control: no-store`.
- Entradas internas são validadas com Zod.
- O webhook Meta valida a assinatura antes de interpretar o JSON.
- Erros esperados retornam mensagens curtas e não expõem stack traces ou secrets.

## `GET /api/health`

Indica se o processo está ativo e quais integrações possuem configuração mínima.

```json
{
  "ok": true,
  "service": "wal-chat",
  "timestamp": "2026-07-21T15:57:11.664Z",
  "integrations": {
    "supabase": true,
    "redis": true,
    "meta": true,
    "gemini": false
  },
  "mode": "demo"
}
```

O campo de integração significa “configuração presente”, não aprovação externa concluída.

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

Em `503`, o endpoint envia `Retry-After: 10` para favorecer uma nova tentativa.

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

| Método   | Endpoint                            | Uso                                                                  |
| -------- | ----------------------------------- | -------------------------------------------------------------------- |
| `POST`   | `/api/integrations/meta/start`      | Cria state de uso único, cookie HttpOnly e URL OAuth                 |
| `GET`    | `/api/integrations/meta/callback`   | Confere cookie/state, troca token, assina webhook e cifra credencial |
| `GET`    | `/api/integrations/meta/status`     | Retorna configuração, URLs e contas sem expor secrets                |
| `POST`   | `/api/integrations/meta/validate`   | Relê perfil e `subscribed_apps`                                      |
| `DELETE` | `/api/integrations/meta/disconnect` | Desassina webhooks e remove token cifrado                            |

Mutações exigem `owner/admin`, bearer token e Origin confiável. O callback é público por protocolo, mas exige state simultaneamente no cookie e no Postgres.

## Configurações e agentes de IA

| Método                  | Endpoint            | Uso                                                 |
| ----------------------- | ------------------- | --------------------------------------------------- |
| `GET/PUT`               | `/api/ai/settings`  | Provedor, modelo, limites e API key cifrada         |
| `GET/POST/PATCH/DELETE` | `/api/ai/agents`    | CRUD de personas e modos                            |
| `GET/POST/PATCH/DELETE` | `/api/ai/knowledge` | CRUD da base textual, sempre filtrada por workspace |

Leitura exige associação ao workspace. Escrita exige `owner/admin`. A chave nunca é devolvida; o status informa apenas `configured` e a origem `tenant`, `server` ou `none`.

## `POST /api/messages/send`

Envio manual autenticado por `owner/admin/agent`. Recebe `contactId`, `message` e `humanAgent`. O backend relê contato e blocklist, aplica compliance, usa o token da conta do mesmo workspace e persiste tanto sucessos quanto bloqueios.

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

## Autenticação dos endpoints

O webhook e a exclusão são públicos por definição do protocolo, mas autenticados por assinatura. Integrações, configurações/agentes de IA e envio manual exigem JWT Supabase e membership explícito. O preview de compliance é uma função pública sem persistência nem efeitos externos; aplique rate limit no proxy antes do Live Mode.
