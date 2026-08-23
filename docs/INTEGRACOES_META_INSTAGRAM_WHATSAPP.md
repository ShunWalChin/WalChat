# Integrações Meta: Instagram e WhatsApp Business

Este runbook descreve a configuração real, os limites de segurança e os testes de aceitação das integrações Meta do Wal Chat. A aplicação permanece em `DEMO_MODE=true` e com os kill switches desligados até todos os gates da Central de Go-Live passarem.

## 1. O que está implementado

### Instagram Professional

- Instagram Login para contas Business ou Creator;
- state OAuth de uso único, code exchange e token cifrado por workspace;
- validação de scopes, perfil, expiração e assinatura de webhooks;
- eventos `messages`, `messaging_postbacks`, `comments`, `mentions` e `message_reactions`;
- Inbox, contatos, gatilhos de DM/story/comentário e Private Reply única;
- mensagens manuais e automáticas pelo gateway de compliance;
- janela padrão de 24h e `HUMAN_AGENT` somente humano em até sete dias.

### WhatsApp Business Platform

- Facebook Login for Business com Embedded Signup;
- validação do app, token, scopes granulares, WABA e propriedade do telefone;
- assinatura e revalidação de `/{WABA-ID}/subscribed_apps`;
- registro opcional do telefone em `/{PHONE-NUMBER-ID}/register`, sem persistir o PIN;
- webhook `whatsapp_business_account` / `messages` com HMAC SHA-256;
- mensagens e statuses `sent`, `delivered`, `read` e `failed` sem regressão;
- texto livre na janela de atendimento de 24h;
- fora da janela, somente template `APPROVED` sincronizado da WABA;
- mídia inbound por proxy autenticado, sem expor o access token no navegador;
- Inbox, CRM, tags, gatilhos, sequências e agentes de IA multicanal;
- opt-out `PARAR`, cooldown e blocklist no gateway central.

## 2. Pré-requisitos na Meta

1. Portfólio empresarial verificado no Meta Business Suite.
2. Aplicativo do tipo Business em Meta for Developers.
3. Produto Instagram e Facebook Login for Business configurados.
4. Conta Instagram Professional de teste ligada ao usuário autorizado.
5. WhatsApp Business Account, número disponível e método de pagamento quando exigido.
6. Usuários de teste, administradores e ativos atribuídos corretamente.
7. Política de Privacidade, Termos e Exclusão de Dados publicados em HTTPS.
8. App Review e Advanced Access antes de atender contas que não têm papel no app.

Permissões Instagram:

```text
instagram_business_basic
instagram_business_manage_messages
instagram_business_manage_comments
instagram_business_content_publish
instagram_business_manage_insights
```

Permissões WhatsApp:

```text
business_management
whatsapp_business_management
whatsapp_business_messaging
```

## 3. URLs da homologação

```text
Origem:                 https://wal-chat.64.181.178.125.nip.io
OAuth Instagram:        https://wal-chat.64.181.178.125.nip.io/api/integrations/meta/callback
Webhook Instagram:      https://wal-chat.64.181.178.125.nip.io/api/public/webhooks/instagram
Webhook WhatsApp:       https://wal-chat.64.181.178.125.nip.io/api/public/webhooks/whatsapp
Exclusão de dados:      https://wal-chat.64.181.178.125.nip.io/api/data-deletion
Política:               https://wal-chat.64.181.178.125.nip.io/privacidade
Termos:                 https://wal-chat.64.181.178.125.nip.io/termos
Instruções de exclusão: https://wal-chat.64.181.178.125.nip.io/exclusao-de-dados
```

Use um verify token por canal. A Meta cria um App ID/Secret próprio para
Instagram Login e outro para o app principal do WhatsApp; o Wal Chat mantém
esses pares isolados para validar OAuth e HMAC com o segredo correto. Nenhum
desses valores pode aparecer no frontend, logs ou repositório.

## 4. Secrets do backend

```dotenv
META_INSTAGRAM_APP_ID=
META_INSTAGRAM_APP_SECRET=
META_INSTAGRAM_VERIFY_TOKEN=
META_WHATSAPP_APP_ID=
META_WHATSAPP_APP_SECRET=
META_WHATSAPP_VERIFY_TOKEN=
META_GRAPH_VERSION=v25.0
META_OAUTH_REDIRECT_URI=https://wal-chat.64.181.178.125.nip.io/api/integrations/meta/callback
META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID=
CREDENTIALS_ENCRYPTION_KEY=
```

`META_APP_ID`, `META_APP_SECRET` e `META_VERIFY_TOKEN` permanecem apenas como
fallback de compatibilidade para instalações anteriores. Novas instalações
devem usar sempre as variáveis específicas por canal.

`META_ACCESS_TOKEN` e `META_PUBLISH_TOKEN` são fallbacks restritos ao modo demo/legado. Em operação multi-tenant, cada token vem do fluxo oficial e é cifrado em `integration_credentials` com AES-256-GCM.

## 5. Configurar Instagram

1. Cadastre a Redirect URI exata no produto Instagram.
2. Cadastre o callback Instagram e o Verify Token em Webhooks.
3. Assine os cinco campos listados na tela Configurações.
4. Entre no Wal Chat como `owner` ou `admin`.
5. Abra **Configurações → Conectar Instagram**.
6. Autorize todos os scopes e selecione a conta profissional piloto.
7. Execute **Validar** e confirme scopes, expiração e campos assinados.
8. Envie uma DM para a conta piloto e confira Inbox e Central de Go-Live.

## 6. Configurar WhatsApp

1. No Facebook Login for Business, crie e publique uma configuração de Embedded Signup.
2. Inclua gestão do negócio, WABA e mensageria na configuração.
3. Salve o Configuration ID em `META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`.
4. Cadastre o callback WhatsApp e assine o campo `messages` no objeto `whatsapp_business_account`.
5. Reinicie a aplicação e abra **Configurações → Conectar WhatsApp**.
6. Conclua o popup da Meta selecionando portfólio, WABA e telefone.
7. O backend troca o code, verifica o app e os scopes, prova que o telefone pertence à WABA, cifra o token e assina a WABA.
8. Se o telefone exigir registro, abra a seção de PIN e informe os seis dígitos. O PIN é enviado diretamente à Meta e descartado.
9. Clique em **Sincronizar templates**.
10. Envie uma mensagem do telefone de teste para abrir a janela de 24h e confirme a conversa na Inbox.

## 7. Regras de envio

| Situação                | Instagram                       | WhatsApp                                                   |
| ----------------------- | ------------------------------- | ---------------------------------------------------------- |
| Inbound há menos de 24h | Texto livre permitido           | Texto livre permitido                                      |
| Após 24h                | Humano com `HUMAN_AGENT` até 7d | Somente template `APPROVED`                                |
| Automação               | Rodapé `Responda PARAR`         | Rodapé no texto; template automatizado deve conter opt-out |
| Opt-out registrado      | Bloqueado                       | Bloqueado                                                  |
| Cooldown do gatilho     | 24h padrão                      | 24h padrão                                                 |
| Comentário              | Uma Private Reply               | Não se aplica                                              |

Nenhuma rota chama a Meta diretamente. Envios manuais, scheduler e IA usam o gateway central, que reconsulta a janela e cria um claim idempotente imediatamente antes do I/O externo.

## 8. Teste de aceitação

Execute primeiro sem disparos externos:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run db:lint
```

Depois, com conta e telefone controlados:

1. challenge GET retorna exatamente o `hub.challenge` com token correto;
2. POST sem assinatura ou com HMAC inválido retorna 401;
3. redelivery idêntica não duplica contato, interação, unread ou automação;
4. DM Instagram e mensagem WhatsApp aparecem na Inbox correta;
5. `PARAR` desliga IA e bloqueia todo envio seguinte;
6. texto WhatsApp fora de 24h é recusado;
7. template pendente/rejeitado é recusado; template aprovado é aceito;
8. status fora de ordem não regride `read` para `delivered`;
9. Private Reply repetida é bloqueada;
10. timeout externo produz entrega `unknown`, sem retry cego;
11. desconectar remove a credencial cifrada e tenta desassinar o ativo remoto;
12. exclusão assinada remove dados e contas dos dois canais e desliga o workspace.

## 9. Promoção para produção

Somente altere `DEMO_MODE=false` depois de:

- aplicar migrations com backup testado;
- configurar SMTP e recuperação de senha;
- receber Advanced Access das permissões usadas;
- validar Nginx, TLS, Redis, workers e callbacks públicos;
- testar contas controladas e documentar os IDs, sem copiar tokens;
- zerar falhas de webhook e entregas `unknown`;
- obter aprovação do responsável do piloto.

Depois disso, cada workspace ainda exige a confirmação `ATIVAR PRODUCAO` na Central de Go-Live. Os recursos Comment-to-DM e IA autônoma possuem switches separados.

## 10. Referências oficiais

- Instagram API: <https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api>
- WhatsApp Cloud API: <https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api>
- Embedded Signup: <https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup>
- Assinatura de WABA: <https://www.postman.com/meta/whatsapp-business-platform/request/2jov46g/subscribe-to-a-waba>
- Templates: <https://www.postman.com/meta/whatsapp-business-platform/folder/lczy75a/templates>
- Payloads de webhook: <https://www.postman.com/meta/whatsapp-business-platform/folder/vzaxn16/webhook-payload-reference>
