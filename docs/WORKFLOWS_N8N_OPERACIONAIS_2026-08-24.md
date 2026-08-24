# Workflows n8n operacionais — 24/08/2026

## Resultado

A suíte n8n do Wal Chat está provisionada e ativa em
<https://n8n.fattech.com.br>. Ela recebe eventos do Wal Chat, expõe comandos
controlados de CRM e automação e monitora a readiness de produção a cada cinco
minutos.

Os 12 workflows de outros projetos existentes na instância não foram
alterados. A suíte Wal Chat usa nomes e caminhos próprios e totaliza cinco
workflows.

## Arquitetura

```text
Wal Chat scheduler/outbox
        |
        | HTTPS + Header Auth + HMAC + deliveryId
        v
[00 Event Gateway] --> valida contrato --> minimiza PII --> classifica evento

Sistema autorizado/n8n
        |
        | HTTPS + Header Auth + deliveryId estável
        +--> [10 Contact Upsert] ------+
        +--> [20 Tag Apply] -----------+--> Webhook inbound Wal Chat
        +--> [30 Automation Execute] --+    anti-replay + idempotência
                                             + gateway de compliance Meta

[90 Production Health] -- a cada 5 min --> GET /api/ready
                       \-- webhook autenticado para diagnóstico imediato
```

Nenhum workflow chama diretamente Instagram ou WhatsApp. Uma automação
iniciada pelo n8n entra no motor do Wal Chat e qualquer envio continua sujeito
a opt-out, blocklist, cooldown, elegibilidade, janela de 24 horas e demais
proteções do canal.

## Inventário de produção

| Ordem | Workflow                                        | ID                 | Estado | Finalidade                             |
| ----: | ----------------------------------------------- | ------------------ | ------ | -------------------------------------- |
|    00 | Wal Chat \| 00 \| Event Gateway v2              | `uCbRdGplYbvWb6HY` | ativo  | Eventos Wal Chat → n8n                 |
|    10 | Wal Chat \| 10 \| Contact Upsert Command v1     | `HZQFO4y1Ke7KVNsE` | ativo  | Criar/atualizar contato externo        |
|    20 | Wal Chat \| 20 \| Tag Apply Command v1          | `jK6lZhtNtm2hKZRk` | ativo  | Criar e associar tag automática        |
|    30 | Wal Chat \| 30 \| Automation Execute Command v1 | `MYrV8CrEs3nfcnL2` | ativo  | Iniciar automação publicada e elegível |
|    90 | Wal Chat \| 90 \| Production Health v1          | `q3rYgAdgBejAYgW2` | ativo  | Readiness agendada e sob demanda       |

### Endpoints

```text
POST https://n8n.fattech.com.br/webhook/wal-chat-events-v1
POST https://n8n.fattech.com.br/webhook/wal-chat-contact-upsert-v1
POST https://n8n.fattech.com.br/webhook/wal-chat-tag-apply-v1
POST https://n8n.fattech.com.br/webhook/wal-chat-automation-execute-v1
POST https://n8n.fattech.com.br/webhook/wal-chat-health-v1
```

Todos exigem a Credential `Wal Chat — Webhook Header Auth v1`. O valor da
credencial não deve ser copiado para workflow, documentação, Git ou frontend.

## Como usar os comandos

Em outro workflow n8n, use um nó **HTTP Request** com:

- método `POST`;
- autenticação `Generic Credential Type > Header Auth`;
- Credential `Wal Chat — Webhook Header Auth v1`;
- `Content-Type: application/json`;
- `deliveryId` determinístico por operação de negócio.

Não use apenas o ID da execução quando uma repetição puder representar a mesma
operação. Exemplos melhores são `crm.contact.123.v7` ou
`booking.456.confirmed.v1`.

### Criar ou atualizar contato

```json
{
  "deliveryId": "crm.contact.123.v7",
  "data": {
    "externalId": "crm-123",
    "fullName": "Ana Souza",
    "email": "ana@example.com",
    "lifecycleStage": "engaged",
    "leadScore": 72,
    "marketingConsent": "granted",
    "customFields": { "origem": "landing-page" }
  }
}
```

Na primeira criação é necessário email ou telefone. Atualizações posteriores
usam `externalId` e preservam os campos não enviados.

### Aplicar tag

O contato precisa ter sido sincronizado pelo comando anterior.

```json
{
  "deliveryId": "crm.contact.123.tag.qualificado.v1",
  "data": {
    "externalId": "crm-123",
    "tagName": "Lead qualificado",
    "tagColor": "#1D7A55"
  }
}
```

### Iniciar automação

```json
{
  "deliveryId": "crm.contact.123.flow.boas-vindas.v1",
  "data": {
    "contactId": "00000000-0000-0000-0000-000000000000",
    "flowId": "00000000-0000-0000-0000-000000000000",
    "platform": "instagram",
    "context": { "sourceCampaign": "lancamento" }
  }
}
```

Antes de usar em produção, confirme:

1. o flow está publicado;
2. o contato pertence ao mesmo workspace;
3. `platform` corresponde ao canal do contato;
4. a conta Meta/WhatsApp está conectada;
5. o contato possui consentimento e elegibilidade;
6. o kill switch de disparos externos está no estado planejado;
7. o piloto usa um contato controlado.

O endpoint está funcional, mas o smoke automatizado deliberadamente não inicia
uma automação real para não enviar mensagem a terceiros.

## Segurança e privacidade

- API key do n8n, signing secret e URL de saída permanecem cifrados por
  workspace no backend.
- Os JSONs dos workflows guardam apenas a referência da Credential, nunca seu
  valor.
- Todos os webhooks n8n usam Header Auth; chamadas anônimas retornam `403`.
- A entrada Wal Chat exige timestamp fresco, token derivado ou HMAC e delivery
  ID de 8–128 caracteres.
- O backend limita a entrada a 120 requisições/minuto por conexão.
- Delivery IDs repetidos com o mesmo conteúdo são idempotentes; com conteúdo
  divergente retornam conflito.
- Workflows de negócio não salvam payloads de sucesso ou erro no histórico do
  n8n, reduzindo retenção de PII.
- O workflow de health salva histórico porque contém apenas estado técnico e
  latência, sem dados de contatos.
- O Event Gateway elimina email, telefone e corpo de mensagem do resultado e
  conserva apenas indicadores e IDs operacionais.
- HTTP Requests de comando usam retry limitado, sempre com o mesmo delivery
  ID, de modo que uma repetição não duplica o efeito no Wal Chat.

Como a API key foi compartilhada durante a configuração, recomenda-se girá-la
no n8n depois da homologação. Em seguida, atualize a conexão pelo wizard do Wal
Chat. Não registre a nova chave em issue, commit ou mensagem.

## Provisionamento reproduzível

Arquivos de fonte:

```text
scripts/ops/n8n-workflow-definitions.ts
scripts/ops/provision-n8n-operational-workflows.ts
scripts/ops/inspect-n8n-instance.ts
scripts/ops/smoke-n8n-operational-workflows.ts
scripts/ops/n8n-workflow-definitions.test.ts
```

O provisionador:

1. recupera credenciais exclusivamente do cofre cifrado;
2. inventaria a Credential do gateway existente;
3. cria ou atualiza workflows pelo nome;
4. mantém nós e Webhook IDs determinísticos;
5. desativa antes de atualizar;
6. valida nomes, nós, versões e ausência de segredos;
7. ativa somente depois da validação;
8. testa gateway, health, autenticação e contratos;
9. restaura snapshots e remove criações novas se qualquer etapa falhar.

Execução no contêiner de produção:

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  exec -T app \
  ./node_modules/.bin/tsx \
  scripts/ops/provision-n8n-operational-workflows.ts
```

O smoke de escrita exige confirmação explícita:

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  exec -T \
  -e N8N_RUN_WRITE_SMOKE=true \
  -e N8N_CONNECTION_ID=412fc7dc-f223-4f15-b062-ac4c8d8249c0 \
  app ./node_modules/.bin/tsx \
  scripts/ops/smoke-n8n-operational-workflows.ts
```

Ele cria contato/tag sintéticos, verifica banco e vínculo, remove os registros
por UUID e confirma zero resíduos. Não inicia automação nem envia mensagem.

## Evidências de validação

| Verificação                                     | Resultado                |
| ----------------------------------------------- | ------------------------ |
| TypeScript                                      | aprovado                 |
| ESLint                                          | aprovado                 |
| Testes automatizados                            | 29 arquivos, 105 testes  |
| Testes das definições n8n                       | 4/4                      |
| Build cliente + SSR                             | aprovado                 |
| `npm audit --omit=dev`                          | 0 vulnerabilidades       |
| Event Gateway `integration.test`                | HTTP 200, 1 tentativa    |
| Health autenticado                              | HTTP 200                 |
| Execução health sob demanda                     | `13507`, success         |
| Gateway/health sem credencial                   | HTTP 403                 |
| Três comandos sem credencial                    | HTTP 403                 |
| Três comandos com contrato vazio                | rejeitados, zero writes  |
| Contact Upsert sintético                        | concluído e verificado   |
| Tag Apply sintético                             | concluído e verificado   |
| Limpeza do smoke                                | concluída, zero resíduos |
| Mensagens reais Meta/WhatsApp durante os testes | 0                        |
| Contêineres app/webhooks/scheduler              | healthy, 0 reinícios     |

Release Wal Chat:

```text
/opt/wal-chat/releases/20260824-n8n-workflows-v2
commit bb2b7aa
imagem sha256:411e3743a60e966b49013ae3f763328428e121c7a222e7e725f84dbede4757df
```

## Operação e incidentes

### Acompanhar

- abra **Integrações > n8n** no Wal Chat para entregas inbound/outbound;
- filtre por `Wal Chat |` no painel n8n;
- use o workflow `90` para health técnico;
- verifique `integration_webhook_deliveries` quando houver retry, duplicidade ou
  erro de contrato;
- execuções de erro criadas no horário do provisionamento dos workflows `10`,
  `20` e `30` são probes intencionais de contrato vazio; não contêm payload e
  não representam falha de produção;
- jamais habilite gravação de payloads nos workflows de negócio sem revisão de
  LGPD e retenção.

### Resposta a incidente

1. desative primeiro `Wal Chat | 30 | Automation Execute Command v1`;
2. se o incidente envolver CRM, desative também `10` e `20`;
3. preserve o Event Gateway para não perder observabilidade de saída;
4. desligue `external_sends_enabled` no Wal Chat se houver risco de disparo;
5. registre delivery IDs, horários e status, sem copiar payloads pessoais;
6. corrija e execute novamente o provisionador idempotente;
7. rode health, testes negativos e smoke sintético antes de reativar o piloto.

### Rollback

- O provisionador faz rollback automático durante uma execução malsucedida.
- Depois de um provisionamento concluído, o rollback de emergência é desativar
  os workflows `10`, `20` e `30`; o gateway v2 é compatível com o endpoint v1.
- A imagem anterior está preservada como
  `wal-chat-app:rollback-20260824-n8n-workflows-v1`.
- A aplicação anterior está em
  `/opt/wal-chat/releases/20260824-n8n-workflows-v1`.
- Não apague entregas, vínculos ou auditorias para efetuar rollback.

## Parecer

A integração está **GO para sincronização controlada de contatos e tags** e
para operação do Event Gateway/health. O comando de automação está ativo e
tecnicamente validado por contrato, autenticação e backend, mas seu primeiro
uso com conta real deve ser um piloto nominal com contato próprio, flow
publicado e observação do gateway de compliance.
