# Integração n8n

Revisão: 22 de agosto de 2026.

## Arquitetura

Cada workspace possui no máximo uma conexão n8n principal. API key, URL do
webhook de produção e segredo HMAC são cifrados em `integration_credentials`.
A tabela `integration_connections` mantém apenas estado operacional
sanitizado. Entrada e saída usam `integration_webhook_deliveries` como inbox e
outbox idempotente.

```text
Wal Chat ── scheduled_jobs ── scheduler ── HMAC/HTTPS ──> n8n Webhook
Wal Chat <── HMAC + replay guard + contrato v1 <──────── n8n HTTP Request
```

Eventos automáticos de saída:

- `contact.created`;
- `message.received`;
- `booking.created`;
- `automation.completed`.

`contact.updated` está no contrato e pode ser emitido pela API privada, mas não
é disparado por trigger de banco para evitar loops de sincronização.

## Configuração pelo wizard

1. No n8n, crie uma API key com o menor acesso disponível para listar
   workflows.
2. Crie um workflow com **Webhook** em `POST`, publique e copie a URL de
   produção. A URL de teste não deve ser salva no Wal Chat.
3. No Wal Chat, abra **Integrações > n8n**.
4. Informe URL base, API key e URL do webhook de produção.
5. Informe um segredo compartilhado com pelo menos 24 caracteres ou deixe o
   backend gerar um. Um segredo gerado aparece uma única vez.
6. Escolha os eventos necessários e clique em **Salvar e validar API**.
7. Copie o webhook inbound do Wal Chat e configure-o no workflow que enviará
   ações de volta.
8. Execute **Testar API** e **Testar webhook**.

Em produção, URLs precisam usar HTTPS e resolver para endereços públicos. Um
host privado só é aceito quando o operador o lista em `N8N_ALLOWED_HOSTS`.

## Contrato Wal Chat → n8n

Método: `POST` para o webhook de produção configurado.

Headers:

```text
Content-Type: application/json
X-WalChat-Delivery-Id: UUID estável
X-WalChat-Event: booking.created
X-WalChat-Timestamp: epoch em segundos
X-WalChat-Webhook-Token: token derivado para Header Auth
X-WalChat-Signature-256: sha256=<hex>
```

Assinatura:

```text
HMAC_SHA256(segredo, timestamp + "." + corpo_bruto)
```

Payload:

```json
{
  "schemaVersion": 1,
  "deliveryId": "ca23c386-65bd-46cb-990f-a27fbfacb83e",
  "eventType": "booking.created",
  "occurredAt": "2026-08-22T18:30:00.000Z",
  "workspace": { "id": "00000000-0000-0000-0000-000000000000" },
  "data": {
    "bookingId": "00000000-0000-0000-0000-000000000000",
    "startAt": "2026-08-23T13:00:00.000Z"
  }
}
```

O workflow provisionado usa uma Credential `httpHeaderAuth` para validar
`X-WalChat-Webhook-Token` antes de executar qualquer nó. O token é derivado por
HMAC em contexto separado e não permite recuperar o segredo que assina os
payloads. O workflow deve deduplicar `X-WalChat-Delivery-Id`. HTTP `408`, `429`
e `5xx` são retentados com limite. Respostas `4xx` permanentes não são
repetidas cegamente.

## Contrato n8n → Wal Chat

Endpoint:

```text
POST /api/public/webhooks/n8n/:connectionId
```

Headers obrigatórios:

```text
Content-Type: application/json
X-WalChat-Delivery-Id: identificador estável de 8 a 128 caracteres
X-WalChat-Timestamp: epoch em segundos
X-WalChat-Signature-256: sha256=<hex>, ou
X-WalChat-Webhook-Token: Credential Header Auth derivada
```

O timestamp é aceito por até cinco minutos. O modo preferencial continua sendo
a assinatura sobre os bytes exatos antes do JSON ser interpretado. Para nós
HTTP Request que não expõem segredo de Credential a expressões, o token
derivado é aceito como alternativa sobre HTTPS; rate limit e delivery ID único
continuam obrigatórios.

## Bootstrap automatizado

O script `scripts/ops/bootstrap-n8n-connection.ts` configura uma instância que
ainda não possui conexão n8n no workspace:

1. valida a API key na API pública HTTPS;
2. gera o segredo HMAC dentro do backend;
3. salva API key e segredo cifrados por workspace;
4. cria uma Credential Header Auth no n8n com apenas o token derivado;
5. cria e ativa o workflow `Wal Chat — Event Gateway v1`;
6. grava a URL do webhook de produção;
7. envia `integration.test` e desfaz os objetos criados se alguma etapa falhar.

Variáveis operacionais obrigatórias:

```text
N8N_BOOTSTRAP_BASE_URL
N8N_BOOTSTRAP_API_KEY
```

Use `N8N_BOOTSTRAP_WORKSPACE_ID` quando o banco possuir mais de um workspace.
O script nunca imprime API key, segredo HMAC nem token derivado.

### Sincronizar contato

```json
{
  "schemaVersion": 1,
  "eventType": "contact.upsert",
  "data": {
    "externalId": "crm-123",
    "fullName": "Ana Souza",
    "email": "ana@example.com",
    "lifecycleStage": "engaged",
    "leadScore": 72,
    "marketingConsent": "granted",
    "customFields": { "origem": "n8n" }
  }
}
```

Email ou telefone é obrigatório apenas na primeira criação. Depois que o
`externalId` estiver vinculado, atualizações parciais preservam os campos não
informados. O vínculo `externalId → contactId` fica persistido em
`integration_contact_links`.

### Aplicar tag

```json
{
  "schemaVersion": 1,
  "eventType": "contact.tag.apply",
  "data": {
    "externalId": "crm-123",
    "tagName": "Lead qualificado",
    "tagColor": "#1D7A55"
  }
}
```

### Iniciar automação publicada

```json
{
  "schemaVersion": 1,
  "eventType": "automation.execute",
  "data": {
    "contactId": "00000000-0000-0000-0000-000000000000",
    "flowId": "00000000-0000-0000-0000-000000000000",
    "platform": "instagram",
    "context": { "sourceCampaign": "lancamento" }
  }
}
```

O backend confirma que contato, canal, flow publicado e workspace coincidem. O
gateway Meta continua validando opt-out, janela de 24 horas e demais regras no
momento do envio.

## Code node para assinar uma chamada inbound

Este trecho exige `node:crypto` liberado no task runner da instância
self-hosted. O segredo deve vir de uma credential ou secret do n8n, nunca de um
campo fixo exportado no workflow.

```javascript
const crypto = require('crypto')
const timestamp = String(Math.floor(Date.now() / 1000))
const deliveryId = crypto.randomUUID()
const body = JSON.stringify({
  schemaVersion: 1,
  eventType: 'contact.upsert',
  data: $json.contact,
})
const signature = `sha256=${crypto
  .createHmac('sha256', $env.WAL_CHAT_WEBHOOK_SECRET)
  .update(`${timestamp}.${body}`, 'utf8')
  .digest('hex')}`

return [{ json: { body, timestamp, deliveryId, signature } }]
```

No **HTTP Request**, use corpo Raw `{{$json.body}}` e os headers acima com os
valores produzidos pelo Code node. Em n8n Cloud, use um mecanismo de segredo
compatível com o plano e a versão da instância.

## Testes obrigatórios

| Caso                            | Resultado esperado                             |
| ------------------------------- | ---------------------------------------------- |
| API key válida                  | lista de workflows aceita e status `connected` |
| API key inválida                | `422`, sem credencial no navegador             |
| URL HTTP em live                | bloqueada                                      |
| IP privado não autorizado       | bloqueado antes do fetch                       |
| Assinatura ausente ou alterada  | `401`                                          |
| Timestamp acima de 5 minutos    | `401`                                          |
| Delivery ID e payload repetidos | `202`, sem repetir efeito                      |
| Delivery ID com outro payload   | `409`, sem executar o conteúdo divergente      |
| JSON ou ação fora do contrato   | `400`                                          |
| Webhook `429`/`5xx`             | retry limitado com o mesmo delivery ID         |
| Webhook `4xx` permanente        | falha terminal e registro observável           |

## Monitoramento e rollback

- Consulte as últimas entregas em **Integrações > n8n**.
- Falhas ficam em `integration_webhook_deliveries` e `scheduled_jobs`.
- O disconnect apaga credenciais e a conexão; entregas e vínculos caem por
  cascade.
- Para rollback de aplicação, volte à imagem anterior. Não reverta a migration
  enquanto houver conexões n8n; desative o conector primeiro.

Referências oficiais: [API do n8n](https://docs.n8n.io/api/),
[Webhook node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/),
[segurança self-hosted](https://docs.n8n.io/hosting/securing/overview/) e
[auditoria de segurança](https://docs.n8n.io/hosting/securing/security-audit/).
