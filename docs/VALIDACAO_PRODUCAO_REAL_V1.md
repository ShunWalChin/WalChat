# Validação de produção real V1

Este é o runbook de promoção do Wal Chat para um primeiro piloto real. Ele transforma o parecer de `no-go` em uma decisão verificável: **go condicionado para um único workspace e uma conta Instagram Professional**, somente depois de todos os gates técnicos e externos abaixo.

Nenhuma etapa deste documento autoriza automaticamente deploy, migration, conexão de conta, `DEMO_MODE=false` ou envio externo. Cada ação mutável exige aprovação específica e registro de quem executou, quando e com qual evidência.

## 1. Escopo da V1 real

### Incluído no piloto

- cadastro/login Supabase com isolamento RLS;
- um workspace e usuários nominados;
- uma conta Instagram Professional via OAuth;
- webhook assinado para DMs, postbacks, comentários, menções e reações;
- Inbox real e envio humano dentro da política Meta;
- um gatilho simples, uma Private Reply e uma sequência curta;
- opt-out, blocklist, cooldown e rodapé `Responda PARAR`;
- agente de IA somente em modo copiloto;
- auditoria de entradas, bloqueios e entregas.

### Fora do piloto

- campanhas ou reengajamento em massa;
- modo autônomo de IA;
- publicação de Feed, Reels, Story ou Carrossel;
- calendário editorial ligado à Graph API;
- auto-like;
- insights reais e métricas editoriais;
- múltiplos clientes ou onboarding público.

As telas fora do piloto podem permanecer visíveis como demonstração, mas não devem ser anunciadas como integrações de produção.

## 2. Infraestrutura e contas necessárias

### Plataforma

- domínio próprio com HTTPS válido; `nip.io` não é o domínio definitivo de App Review;
- Supabase gerenciado ou distribuição self-hosted oficial;
- Postgres com backup automático e restore ensaiado;
- Redis persistente acessível somente pela rede privada;
- SMTP transacional para confirmação e recuperação de senha;
- Nginx/gateway, DNS, logs, métricas e alertas;
- um ambiente separado de produção, com secrets próprios.

### Meta

- Business Portfolio verificado;
- app Meta ligado ao negócio e em modo apropriado para os testadores;
- Instagram Professional sob controle do negócio e do usuário de teste; uma Página do Facebook não é obrigatória no fluxo Instagram Login;
- usuário Meta com papel no app e acesso ao ativo;
- App ID, App Secret e Verify Token exclusivos do ambiente;
- Redirect URI e Callback URL idênticos aos cadastrados;
- permissões/Advanced Access aprovados para as funcionalidades do piloto;
- política, termos e exclusão de dados publicados em HTTPS.

### IA

- projeto e API key OpenAI ou Gemini exclusivos do ambiente;
- orçamento, limite de uso e alertas definidos;
- chave armazenada cifrada pelo workspace ou como secret do backend;
- agente piloto em modo `copilot`.

## 3. Contrato de configuração

Valores secretos nunca entram no Git, issue, PR, screenshot ou relatório. A implantação deve fornecer:

```text
APP_ORIGIN
DEMO_MODE
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
REDIS_URL
META_APP_ID
META_APP_SECRET
META_VERIFY_TOKEN
META_OAUTH_REDIRECT_URI
META_GRAPH_VERSION
CREDENTIALS_ENCRYPTION_KEY
OPENAI_API_KEY
OPENAI_MODEL
OPENAI_PROJECT
OPENAI_ORGANIZATION
GOOGLE_GENERATIVE_AI_API_KEY
```

Use somente o provedor de IA escolhido. Tokens de usuário Meta são obtidos pelo OAuth e cifrados em `integration_credentials`; não devem ser copiados para variáveis do frontend.

## 4. Gates de promoção

| Gate       | Evidência mínima                                     | Resultado exigido                 |
| ---------- | ---------------------------------------------------- | --------------------------------- |
| Código     | CI, testes, build, audit e imagem                    | Todos verdes                      |
| Banco      | Backup, migration versionada e RLS com dois usuários | Sem perda ou acesso cruzado       |
| Runtime    | `/api/health`, `/api/ready` e heartbeats             | Todos saudáveis                   |
| Borda      | HTTPS, headers e testes de rate limit                | `429` e `Retry-After` confirmados |
| Meta       | OAuth, perfil e `subscribed_apps`                    | Conta piloto conectada            |
| Webhook    | Challenge, HMAC e evento real                        | Evento aparece uma vez na Inbox   |
| Entrega    | DM permitida, bloqueada e ambígua                    | Sem duplicidade                   |
| Compliance | 24 h, opt-out, cooldown e Private Reply              | Matriz integral aprovada          |
| IA         | Copiloto, limites e isolamento                       | Sem envio autônomo                |
| Operação   | Alertas, rollback e responsáveis                     | Plantão nominal definido          |

Se qualquer resultado exigido falhar, o status permanece `no-go`.

## 5. Execução por fases

### Fase 0 — deploy inerte

1. Criar a infraestrutura de produção e os secrets exclusivos.
2. Publicar a versão aprovada com `DEMO_MODE=true`.
3. Confirmar que nenhuma credencial da homologação foi reutilizada.
4. Validar liveness, readiness, worker, scheduler e headers.
5. Manter o tráfego externo de mensageria desabilitado.

Checkpoint: aprovação do responsável técnico para preparar banco e integrações.

### Fase 1 — dados

1. Capturar backup e registrar o identificador.
2. Aplicar migrations em ordem, incluindo `20260730223000_outbound_delivery_idempotency.sql`.
3. Executar lint do banco.
4. Criar dois usuários de teste em workspaces diferentes.
5. Confirmar que JWT de um workspace não lê nem altera linhas do outro.
6. Ensaiar o procedimento de restore em ambiente isolado.

Checkpoint: aprovação do responsável por dados. Uma migration não pode ser revertida apagando dados manualmente.

### Fase 2 — borda e observabilidade

1. Confirmar HTTPS, HSTS, CSP e `server_tokens off`.
2. Validar `429` e `Retry-After` para rota geral, OAuth e envio/IA.
3. Criar alertas para readiness, heartbeat ausente, fila falha, scheduler atrasado, erro Meta e custo de IA.
4. Confirmar que logs não contêm tokens, URLs assinadas ou corpo integral sensível.
5. Criar a fila operacional para `outbound_deliveries.status = 'unknown'`.

Checkpoint: aprovação de operação.

### Fase 3 — conexão Meta piloto

1. Cadastrar URLs definitivas no app Meta.
2. Publicar as assinaturas do webhook.
3. Entrar no Wal Chat com o usuário `owner`.
4. Em Configurações, iniciar OAuth e selecionar somente a conta piloto.
5. Confirmar username, scopes, validade e `subscribed_apps`.
6. Desconectar/reconectar uma vez para validar revogação e novo state.

Checkpoint: autorização explícita para conectar a conta real. Ainda não autoriza envio.

### Fase 4 — webhook real

1. Enviar uma DM de uma conta controlada para o Instagram piloto.
2. Confirmar HMAC válido, um `webhook_event`, um job e uma interação.
3. Reentregar o mesmo payload assinado e confirmar ausência de duplicidade.
4. Parar brevemente o consumidor, receber um evento e confirmar a reconciliação do outbox após a retomada.
5. Confirmar que assinatura inválida retorna `401`.

Checkpoint: webhook e reconciliação aprovados.

### Fase 5 — entrega manual e idempotência

1. Usar uma conversa controlada dentro da janela de 24 horas.
2. Enviar uma mensagem humana curta pela Inbox.
3. Confirmar um `outbound_delivery` em `sent`, um `interactions_log` e uma mensagem.
4. Repetir a mesma requisição com o mesmo `Idempotency-Key` e confirmar `replayed: true`, sem segunda DM.
5. Repetir a chave com outro texto e confirmar `409 idempotency_conflict`.
6. Simular timeout após o claim e confirmar estado `unknown` e ausência de retry automático.
7. Resolver o estado ambíguo consultando o histórico da conta antes de autorizar nova ação.

Checkpoint: aprovação nominal de segurança de entrega.

### Fase 6 — automação controlada

1. Ativar somente um gatilho de palavra-chave.
2. Confirmar uma DM automática com o rodapé de opt-out.
3. Repetir o gatilho e confirmar cooldown de 24 horas.
4. Responder `PARAR` e confirmar bloqueio de todo novo envio.
5. Criar um comentário controlado e confirmar uma única Private Reply.
6. Tentar responder de novo e confirmar `comment_already_replied`.
7. Confirmar bloqueio fora da janela de 24 horas.

Não usar `HUMAN_AGENT` em automação.

### Fase 7 — IA copiloto

1. Configurar o provedor com budget baixo e chave cifrada.
2. Criar um agente sem modo autônomo.
3. Testar conhecimento permitido, prompt injection, dados de outro tenant e conteúdo da blocklist.
4. Confirmar que a sugestão exige revisão humana.
5. Simular timeout e erro do provedor; nenhuma mensagem deve ser enviada.

### Fase 8 — ativação do piloto

Somente depois de todos os gates:

1. registrar a decisão `go`, responsáveis e janela do piloto;
2. autorizar explicitamente `DEMO_MODE=false`;
3. liberar apenas os usuários, conta e gatilho aprovados;
4. acompanhar em tempo real durante a janela inicial;
5. manter campanhas, publicação, modo autônomo e demais módulos desabilitados.

## 6. Contas de usuário

1. O primeiro cadastro cria o workspace e recebe papel `owner`.
2. Use e-mail corporativo individual; não compartilhe logins.
3. Confirme o e-mail pelo SMTP de produção.
4. Conceda:
   - `owner` a no máximo dois responsáveis;
   - `admin` a quem configura integrações;
   - `agent` a quem atende a Inbox;
   - `viewer` a quem só consulta.
5. Teste logout, recuperação de senha e revogação de sessão.
6. Remova imediatamente usuários desligados e registre a alteração.

## 7. Evidências a anexar ao release

- SHA do commit e imagem;
- resultado da CI;
- data/ID do backup e migrations aplicadas;
- resposta sanitizada de `/api/ready`;
- status dos heartbeats;
- screenshot sem secrets do OAuth e `subscribed_apps`;
- IDs internos dos eventos e entregas de teste;
- matriz de compliance assinada;
- resultado do teste de duplicidade e ambiguidade;
- plano/resultado de rollback;
- aprovadores e horário do `go`.

## 8. Rollback

Dispare rollback se houver duplicidade, envio fora da política, evento perdido, vazamento entre tenants, secret exposto, readiness instável ou fila sem processamento.

1. Voltar imediatamente para `DEMO_MODE=true` ou bloquear a saída na borda.
2. Desativar gatilhos e scheduler do workspace piloto.
3. Preservar logs e IDs sem divulgar conteúdo sensível.
4. Revogar tokens se houver risco de credencial.
5. Restaurar a última imagem aprovada.
6. Não reenviar entregas `unknown` sem reconciliação humana.
7. Restaurar banco somente com decisão do responsável por dados e backup verificado.

## 9. Decisão desta branch

O código desta branch remove dois bloqueadores internos de alto risco — duplicidade de DM e eventos persistidos fora da fila — e prepara timeout/rate limit. A decisão correta após a bateria local é:

- **go para PR e deploy inerte com `DEMO_MODE=true`**, se CI e revisão forem aprovadas;
- **go condicionado para conectar uma conta piloto**, após infraestrutura, migration, secrets e Meta estarem aprovados;
- **no-go para `DEMO_MODE=false` e efeitos externos** até concluir as fases 0–7 com evidência;
- **no-go para escala, campanhas e módulos fora do escopo da V1**.
