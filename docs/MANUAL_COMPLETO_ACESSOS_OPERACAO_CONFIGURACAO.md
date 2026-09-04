# Wal Chat — Manual completo de acessos, operação e configuração

Atualizado em: 03/09/2026

Ambiente auditado: produção Oracle Cloud

Aplicação: [https://wal-chat.64.181.178.125.nip.io](https://wal-chat.64.181.178.125.nip.io)

> Este manual não contém senhas, tokens da Meta, chaves de IA nem chaves do
> Supabase. As credenciais de operador ficam no cofre local indicado na seção 3.
> Nunca envie o cofre por e-mail, WhatsApp, issue, commit ou chat.

> **Este repositório é público.** Identificadores que servem de alvo direto —
> usuário SSH, caminho da chave privada e e-mail das contas administrativas —
> aparecem aqui como marcadores `<ASSIM>`. Os valores reais ficam apenas no
> cofre `Acessos Privados/`. Substitua o marcador na hora de executar o comando
> e não recoloque o valor concreto no arquivo versionado.
>
> | Marcador                          | Onde está o valor real                                      |
> | --------------------------------- | ----------------------------------------------------------- |
> | `<IP_DO_SERVIDOR>`                | Cofre local (o `nip.io` do ambiente atual já expõe este IP) |
> | `<USUARIO_SSH>`                   | Cofre local                                                 |
> | `<USUARIO_SSH_RECUPERACAO>`       | Cofre local                                                 |
> | `<CAMINHO_DA_CHAVE_SSH>`          | Máquina do operador                                         |
> | `<CONTA_OWNER>` / `<CONTA_ADMIN>` | Cofre local                                                 |

## 1. Situação atual do ambiente

Verificação direta executada em **03/09/2026**:

| Item                        | Estado confirmado                                                              |
| --------------------------- | ------------------------------------------------------------------------------ |
| Aplicação e HTTPS           | `200`; processo vivo e modo `live`                                             |
| Readiness                   | `200`; Supabase e Redis `up`                                                   |
| Release ativa               | `/opt/wal-chat/releases/20260831-ux-v1`                                        |
| Contêineres Wal Chat        | aplicação, Redis, scheduler e worker de webhooks saudáveis                     |
| Capacidade do servidor      | volume raiz com 47% de uso                                                     |
| Meta / Instagram / WhatsApp | configuração de runtime detectada                                              |
| Google Workspace            | configuração de runtime detectada                                              |
| OpenAI                      | chave cifrada de workspace detectada; botão **Salvar configurações** publicado |
| Gemini                      | não configurado                                                                |
| n8n                         | painel e `/healthz` respondendo `200`                                          |
| Telas web                   | 26 endereços auditados respondendo `200` após redirecionamentos canônicos      |

`/api/health` mostra somente chaves presentes no ambiente do servidor. Por isso
ele informa `openai: false`; `/api/ready` também consulta o cofre cifrado dos
workspaces e informa `openaiConfigured: true`. A chave de IA pode, portanto,
ficar armazenada por workspace sem aparecer como variável de ambiente.

### 1.1 Diferença entre produção e a base local

O rastreamento de conversões Google Ads OCI e Meta CAPI está implementado e
testado na base local, mas **ainda não está publicado**: o endpoint
`/api/integrations/conversions/status` responde `404` em produção. O refino de
usabilidade de 03/09 também está somente no worktree local.

A base local passa em 399 testes, ESLint e build cliente/SSR. O deploy deve
permanecer bloqueado até resolver o portão `audit:system`, que encontrou 67
escritas sem verificação explícita para um teto de 56, reconciliar a branch com
`github/main`, versionar as alterações e criar um backup pré-release novo.

## 2. Todos os links de acesso

### 2.1 Aplicação e módulos autenticados

Todos estes links foram validados em 03/09/2026. Sem sessão, a aplicação abre a
tela pública de autenticação; o conteúdo interno exige uma conta autorizada.

| Grupo     | Área                   | Link                                                                        |
| --------- | ---------------------- | --------------------------------------------------------------------------- |
| Acesso    | Entrada e autenticação | [Abrir Wal Chat](https://wal-chat.64.181.178.125.nip.io/)                   |
| Conversas | Visão geral            | [Abrir Dashboard](https://wal-chat.64.181.178.125.nip.io/dashboard)         |
| Conversas | Operação & Go-Live     | [Abrir Operações](https://wal-chat.64.181.178.125.nip.io/operacoes)         |
| Conversas | Inbox                  | [Abrir Inbox](https://wal-chat.64.181.178.125.nip.io/inbox)                 |
| CRM       | Pipeline               | [Abrir Pipeline](https://wal-chat.64.181.178.125.nip.io/crm)                |
| CRM       | Radar de risco         | [Abrir Radar](https://wal-chat.64.181.178.125.nip.io/radar)                 |
| CRM       | Contatos e tags        | [Abrir Contatos](https://wal-chat.64.181.178.125.nip.io/contatos)           |
| CRM       | Respostas rápidas      | [Abrir Respostas](https://wal-chat.64.181.178.125.nip.io/respostas)         |
| CRM       | Equipe                 | [Abrir Equipe](https://wal-chat.64.181.178.125.nip.io/equipe)               |
| Automação | Gatilhos               | [Abrir Gatilhos](https://wal-chat.64.181.178.125.nip.io/gatilhos)           |
| Automação | Boas-vindas            | [Abrir Boas-vindas](https://wal-chat.64.181.178.125.nip.io/boas-vindas)     |
| Automação | Captação               | [Abrir Captação](https://wal-chat.64.181.178.125.nip.io/captacao)           |
| Automação | Comment-to-DM          | [Abrir Comment-to-DM](https://wal-chat.64.181.178.125.nip.io/comment-to-dm) |
| Automação | Sequências             | [Abrir Sequências](https://wal-chat.64.181.178.125.nip.io/sequencias)       |
| Automação | Agentes de IA          | [Abrir Agentes](https://wal-chat.64.181.178.125.nip.io/agentes)             |
| Automação | Governança de IA       | [Abrir Governança](https://wal-chat.64.181.178.125.nip.io/governanca)       |
| Automação | Reengajamento          | [Abrir Reengajamento](https://wal-chat.64.181.178.125.nip.io/reengajamento) |
| Automação | Auto-like              | [Abrir Auto-like](https://wal-chat.64.181.178.125.nip.io/auto-like)         |
| Conteúdo  | Calendário             | [Abrir Calendário](https://wal-chat.64.181.178.125.nip.io/calendario)       |
| Conteúdo  | Publicar               | [Abrir Publicar](https://wal-chat.64.181.178.125.nip.io/publicar)           |
| Conteúdo  | Insights               | [Abrir Insights](https://wal-chat.64.181.178.125.nip.io/insights)           |
| Sistema   | Integrações            | [Abrir Integrações](https://wal-chat.64.181.178.125.nip.io/integracoes)     |
| Sistema   | Webhooks de leads      | [Abrir Webhooks](https://wal-chat.64.181.178.125.nip.io/webhooks)           |
| Sistema   | Auditoria              | [Abrir Auditoria](https://wal-chat.64.181.178.125.nip.io/auditoria)         |
| Conta     | Configurações          | [Abrir Configurações](https://wal-chat.64.181.178.125.nip.io/configuracoes) |
| Ajuda     | Manual no sistema      | [Abrir Manual](https://wal-chat.64.181.178.125.nip.io/manual)               |

### 2.2 Endpoints públicos e legais

| Recurso                      | Link/finalidade                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Liveness                     | [`/api/health`](https://wal-chat.64.181.178.125.nip.io/api/health)                    |
| Readiness                    | [`/api/ready`](https://wal-chat.64.181.178.125.nip.io/api/ready)                      |
| Robots                       | [`/robots.txt`](https://wal-chat.64.181.178.125.nip.io/robots.txt)                    |
| Sitemap                      | [`/sitemap.xml`](https://wal-chat.64.181.178.125.nip.io/sitemap.xml)                  |
| Página pública de agenda     | `https://wal-chat.64.181.178.125.nip.io/agendar/<SLUG_DA_AGENDA>`                     |
| Confirmação pública          | [Abrir Obrigado](https://wal-chat.64.181.178.125.nip.io/obrigado)                     |
| Configuração pública do Auth | [Supabase Auth Settings](https://api-wal-chat.64.181.178.125.nip.io/auth/v1/settings) |
| Webhook Instagram            | `https://wal-chat.64.181.178.125.nip.io/api/public/webhooks/instagram`                |
| Webhook WhatsApp             | `https://wal-chat.64.181.178.125.nip.io/api/public/webhooks/whatsapp`                 |
| Callback OAuth Meta          | `https://wal-chat.64.181.178.125.nip.io/api/integrations/meta/callback`               |
| Callback OAuth Google        | `https://wal-chat.64.181.178.125.nip.io/api/integrations/google/callback`             |
| Exclusão assinada Meta       | `https://wal-chat.64.181.178.125.nip.io/api/data-deletion`                            |
| Política de Privacidade      | [Abrir Política](https://wal-chat.64.181.178.125.nip.io/privacidade)                  |
| Termos de Uso                | [Abrir Termos](https://wal-chat.64.181.178.125.nip.io/termos)                         |
| Instruções de exclusão       | [Abrir Exclusão de Dados](https://wal-chat.64.181.178.125.nip.io/exclusao-de-dados)   |

A raiz da API Supabase responde `404` por desenho; isso não significa falha. O
endpoint público de configuração do Auth, usado como sonda, responde `200`.

O endereço legado `https://mano-chat.64.181.178.125.nip.io` redireciona para o
Wal Chat. Não use o endereço legado em novas integrações.

### 2.3 Painéis externos necessários

| Serviço              | Link                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| n8n Wal Chat         | [n8n.fattech.com.br](https://n8n.fattech.com.br/)                     |
| Saúde do n8n         | [n8n.fattech.com.br/healthz](https://n8n.fattech.com.br/healthz)      |
| Meta for Developers  | [developers.facebook.com/apps](https://developers.facebook.com/apps/) |
| Meta Business Suite  | [business.facebook.com](https://business.facebook.com/)               |
| OpenAI Platform      | [platform.openai.com](https://platform.openai.com/)                   |
| Chaves OpenAI        | [API Keys](https://platform.openai.com/api-keys)                      |
| Uso OpenAI           | [Usage](https://platform.openai.com/usage)                            |
| Google AI Studio     | [aistudio.google.com](https://aistudio.google.com/)                   |
| Google Ads           | [ads.google.com](https://ads.google.com/)                             |
| Google Cloud Console | [console.cloud.google.com](https://console.cloud.google.com/)         |
| Repositório GitHub   | [ShunWalChin/WalChat](https://github.com/ShunWalChin/WalChat)         |

### 2.4 Ambiente local de desenvolvimento

| Serviço         | Link                                             |
| --------------- | ------------------------------------------------ |
| Aplicação       | [http://127.0.0.1:3001](http://127.0.0.1:3001)   |
| Supabase API    | [http://127.0.0.1:54321](http://127.0.0.1:54321) |
| Supabase Studio | [http://127.0.0.1:54323](http://127.0.0.1:54323) |
| Mailpit         | [http://127.0.0.1:54324](http://127.0.0.1:54324) |

Esses endereços só respondem quando a stack local está iniciada.

### 2.5 Painéis internos por túnel SSH

Os painéis internos não são publicados na internet.

Supabase Studio:

```powershell
ssh -i "<CAMINHO_DA_CHAVE_SSH>" -L 54353:127.0.0.1:54353 <USUARIO_SSH>@<IP_DO_SERVIDOR>
```

Com o túnel aberto, acessar [http://127.0.0.1:54353](http://127.0.0.1:54353).

Caixa de e-mails local Inbucket:

```powershell
ssh -i "<CAMINHO_DA_CHAVE_SSH>" -L 54354:127.0.0.1:54354 <USUARIO_SSH>@<IP_DO_SERVIDOR>
```

Depois acessar [http://127.0.0.1:54354](http://127.0.0.1:54354).

## 3. Usuários, logins e cofre de senhas

### 3.1 Usuários do aplicativo

| Login                | Papel                     | Uso                                         |
| -------------------- | ------------------------- | ------------------------------------------- |
| `<CONTA_OWNER>`      | `owner`                   | Titular técnico do workspace administrativo |
| `<CONTA_ADMIN>`      | `admin`                   | Administração diária e configuração         |
| `demo@walchat.local` | `owner` do workspace demo | Smoke test e demonstração isolada           |

As três contas foram autenticadas com sucesso em 17/08/2026. As senhas estão em:

`H:\Documentos\F.A.T Tech 2026\Mano Chat - Personalizado\Acessos Privados\CREDENCIAIS-WAL-CHAT-2026-08-17.txt`

A pasta `Acessos Privados` está no `.gitignore` e não deve ser versionada.

As contas `.local` são técnicas e não recebem recuperação por e-mail. Antes do
Live Mode, criar contas nominais com e-mail real, configurar SMTP e manter a
conta `<CONTA_OWNER>` somente como acesso de emergência.

### 3.2 Papéis disponíveis

| Papel    | Permissões esperadas                                             |
| -------- | ---------------------------------------------------------------- |
| `owner`  | Titular, usuários, integrações, IA, gatilhos e operação completa |
| `admin`  | Configura integrações, IA, gatilhos e operação do workspace      |
| `agent`  | Operação assistida de Inbox e conteúdo                           |
| `viewer` | Consulta, sem permissão para alterar configuração crítica        |

O banco aplica RLS por workspace. Um usuário não deve acessar dados de outro
tenant mesmo conhecendo IDs internos.

### 3.3 Usuários do servidor

| Usuário                     | Autenticação                 | Observação                                                           |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `<USUARIO_SSH>`             | Chave SSH                    | Administração principal; possui `sudo` e grupo Docker                |
| `<USUARIO_SSH_RECUPERACAO>` | Chave SSH                    | Conta Oracle preservada para recuperação; possui `sudo`              |
| `root`                      | Sem login direto operacional | Acessado com `sudo -i`; login SSH direto bloqueado pela chave Oracle |

Os demais usuários Linux (`nginx`, serviços Oracle, contêineres e contas com
`nologin`) são identidades técnicas do sistema operacional, não contas humanas
do Wal Chat. Não possuem senha de operador a ser compartilhada.

Acesso recomendado:

```powershell
ssh -i "<CAMINHO_DA_CHAVE_SSH>" <USUARIO_SSH>@<IP_DO_SERVIDOR>
sudo -i
```

Não habilitar `PasswordAuthentication` nem login root por senha.

## 4. Primeiro acesso ao Wal Chat

1. Abra a página de entrada.
2. Use `<CONTA_OWNER>` ou `<CONTA_ADMIN>` e consulte a senha no cofre.
3. Confirme que o topo mostra o usuário autenticado, e não `Wal Demo`.
4. Abra **Configurações**.
5. Confirme o estado da Meta e da IA. No workspace operacional, Meta e OpenAI
   devem aparecer configurados; Gemini permanece opcional e não configurado.
6. Abra **Operações** e confira readiness, canais e os três kill switches antes
   de qualquer ação externa.
7. A produção está em `DEMO_MODE=false`. Não inicie disparos, campanhas ou IA
   autônoma sem contato controlado, consentimento e autorização do responsável.

O botão **Explorar o modo demo** cria uma sessão visual local. Ele não substitui
o login Supabase e não deve ser usado para configurar Meta ou IA.

## 5. Matriz real das funcionalidades

| Módulo                      | Estado implantado                 | O que funciona hoje                                                                                                               |
| --------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Autenticação e multi-tenant | Operacional                       | Login Supabase, sessão, papéis, workspace e RLS                                                                                   |
| Central Go-Live             | Operacional                       | Readiness, diagnóstico e três kill switches por workspace                                                                         |
| Meta / Instagram            | Operacional no workspace Wal Demo | OAuth, token cifrado, campos assinados, webhook HMAC, polling e worker                                                            |
| WhatsApp                    | Infraestrutura pronta             | Embedded Signup, WABA, telefone, templates, mídia e receipts; falta registrar canal no workspace                                  |
| Observabilidade             | Operacional                       | Status, tentativas, latência, auditoria e replay restrito a falhas                                                                |
| Inbox                       | Operacional                       | Conversas, filtros, atribuição, prioridade, notas, IA e envio com compliance                                                      |
| CRM e radar                 | Operacional                       | Quadro/lista, drag-and-drop, edição 360º, filtros, tarefas, notas, links/documentos, etapas, score, risco e concorrência otimista |
| Contatos e tags             | Operacional                       | Perfil 360º, filtros, lote, campos, notas, elegibilidade e CSV                                                                    |
| Equipe e respostas          | Operacional                       | Capacidade, horários, distribuição e templates compartilháveis                                                                    |
| Gatilhos e boas-vindas      | Operacional                       | Origens Meta/WhatsApp, resposta, sequência, cooldown e tags                                                                       |
| Captação                    | Operacional                       | Links, QR codes e webhooks de lead isolados e idempotentes                                                                        |
| Comment-to-DM               | Operacional e protegido           | Publicação real, até 20 palavras, cooldown, limite por conta e Private Reply única                                                |
| Sequências                  | Operacional                       | Automation Studio v2, DAG versionado, simulação e scheduler                                                                       |
| IA OpenAI                   | Operacional                       | Configuração e chave cifrada por workspace, agentes, playground e telemetria                                                      |
| Gemini                      | Implementado, não configurado     | Alternativa de provedor disponível após salvar uma chave válida                                                                   |
| Governança de IA            | Operacional                       | Orçamento, versões, roteamento, memória, revisão humana e logs                                                                    |
| Dashboard                   | Operacional                       | Métricas de DMs, comentários, canais, contatos e insights persistidos                                                             |
| Reengajamento               | Operacional e protegido           | Preview, persistência, início, pausa, cancelamento e controle de vazão                                                            |
| Calendário                  | Operacional                       | Mês/semana/agenda, CRUD, reservas públicas, Calendar, Tasks, Meet e Free/Busy                                                     |
| Publicar                    | Operacional e protegido           | Feed, Reel, Story e Carrossel persistidos, agendados e enviados pelo scheduler                                                    |
| Insights                    | Operacional                       | Métricas oficiais diárias, por publicação e histórico de seguidores                                                               |
| n8n                         | Operacional                       | Gateway bidirecional, HMAC, idempotência e workflows ativos                                                                       |
| Auto-like                   | Limitação oficial                 | Preferências são salvas; a API oficial da Meta não permite curtir comentários                                                     |
| OCI/CAPI                    | Implementado apenas localmente    | Google Ads OCI e Meta CAPI aguardam release de produção                                                                           |
| Páginas legais e SEO        | Operacional                       | Privacidade, termos, exclusão, sitemap, robots, OG e JSON-LD                                                                      |

### Consequência operacional

É correto usar agora, respeitando papéis, consentimento e os gates:

- autenticação e papéis;
- configuração de Meta, OpenAI, Google e n8n;
- CRM, Contatos, Inbox, Equipe e respostas rápidas;
- agentes, base de conhecimento, playground e governança de IA;
- gatilhos, captação, sequências e Comment-to-DM;
- calendário, agendamento público, publicação e insights;
- Central de Go-Live, auditoria, webhook e filas.

Limitações e pendências que não devem ser confundidas com recurso ativo:

- OCI/CAPI ainda não está na release publicada;
- auto-like não executa curtidas por ausência de endpoint oficial da Meta;
- Google exige conexão OAuth por workspace antes de sincronizar;
- WhatsApp exige WABA e telefone registrados no workspace;
- campanhas e envios externos exigem canário controlado e revisão dos gates;
- domínio próprio, cobrança e automação de backup continuam pendentes.

## 6. Configuração completa da Meta

### 6.1 Pré-requisitos

1. Conta Meta Developer.
2. Portfólio empresarial no Meta Business Suite.
3. Aplicativo Meta com o produto Instagram.
4. Instagram Professional, Business ou Creator.
5. Usuário que administra a conta do Instagram.
6. Para atender contas de terceiros, App Review e Advanced Access para as
   permissões solicitadas.
7. Para revisão e Live Mode, política, termos, exclusão de dados, domínio HTTPS
   e gravação do fluxo solicitado pela Meta.

A coleção oficial da Meta informa que Instagram Login trabalha com contas
Professional e que acesso a contas fora das funções do aplicativo exige o nível
de acesso apropriado. Consulte a
[documentação oficial da Instagram API publicada pela Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

### 6.2 URLs que devem ser cadastradas na Meta

```text
Site URL:
https://wal-chat.64.181.178.125.nip.io

OAuth Redirect URI:
https://wal-chat.64.181.178.125.nip.io/api/integrations/meta/callback

Webhook Callback URL:
https://wal-chat.64.181.178.125.nip.io/api/public/webhooks/instagram

Data Deletion Callback:
https://wal-chat.64.181.178.125.nip.io/api/data-deletion

Privacy Policy:
https://wal-chat.64.181.178.125.nip.io/privacidade

Terms of Service:
https://wal-chat.64.181.178.125.nip.io/termos

Data Deletion Instructions:
https://wal-chat.64.181.178.125.nip.io/exclusao-de-dados
```

### 6.3 Permissões solicitadas pelo código implantado

```text
instagram_business_basic
instagram_business_manage_messages
instagram_business_manage_comments
instagram_business_content_publish
instagram_business_manage_insights
```

Não misturar essas permissões do fluxo Instagram Login com permissões antigas
do fluxo Facebook Login sem antes alterar a arquitetura OAuth.

### 6.4 Campos de webhook solicitados

```text
messages
messaging_postbacks
messaging_seen
message_reactions
comments
live_comments
mentions
story_insights
```

O código assina esses campos automaticamente no endpoint
`/{instagram_user_id}/subscribed_apps`. A Meta mantém um exemplo oficial de
[assinatura de webhooks](https://www.postman.com/meta/instagram/request/23987686-0223707a-7035-46a2-8015-1fdf7249278f).

### 6.5 Configuração no servidor

Entre por SSH e edite os segredos com `sudoedit`:

```bash
sudoedit /opt/wal-chat/app/.env.production
```

Preencher no mínimo:

```dotenv
META_APP_ID=ID_DO_APLICATIVO
META_APP_SECRET=SEGREDO_DO_APLICATIVO
META_VERIFY_TOKEN=TOKEN_FORTE_QUE_TAMBEM_SERA_USADO_NO_PAINEL_META
META_GRAPH_VERSION=v25.0
META_OAUTH_REDIRECT_URI=https://wal-chat.64.181.178.125.nip.io/api/integrations/meta/callback
```

Não é necessário cadastrar token de cada cliente no arquivo. O fluxo OAuth
salva o token por workspace, cifrado no banco com
`CREDENTIALS_ENCRYPTION_KEY`.

Recrie os processos Node após alterar o ambiente:

```bash
sudo docker compose \
  --project-directory /opt/wal-chat/app \
  --env-file /opt/wal-chat/app/.env.production \
  -f /opt/wal-chat/app/docker-compose.production.yml \
  up -d --no-build --force-recreate --no-deps app webhooks scheduler
```

### 6.6 Conectar a conta pelo Wal Chat

1. Faça login com `<CONTA_OWNER>` ou uma futura conta nominal `owner`.
2. Abra **Configurações**.
3. Clique em **Conectar Instagram**.
4. Autorize todas as permissões solicitadas.
5. Aguarde o retorno para `/configuracoes?meta=connected`.
6. Clique em **Validar**.
7. Confirme que não existem permissões ou campos de webhook ausentes.
8. Abra **Comment-to-DM**, sincronize os posts e crie uma regra piloto inativa.
9. Envie uma DM e um comentário usando uma conta de teste diferente.
10. Confirme o recebimento na Inbox e na observabilidade antes de testar uma resposta.
11. Siga a ordem de ativação documentada na Central de Go-Live; deixe IA autônoma por último.

### 6.7 Regras obrigatórias de mensageria

- DM automática somente na janela padrão de 24 horas após inbound.
- `HUMAN_AGENT` somente para resposta humana, até 7 dias.
- O código bloqueia uso automático da tag `HUMAN_AGENT`.
- Toda mensagem automática recebe `Responda PARAR`.
- `PARAR` marca opt-out e desativa IA para o contato.
- Cooldown padrão de 24 horas por contato e gatilho.
- Uma única Private Reply por comentário, dentro da janela permitida.
- Blocklist é verificada antes do envio.
- Campanhas devem recalcular elegibilidade no momento do envio.

## 7. Configuração da OpenAI

### 7.1 Criar a chave

1. Crie ou escolha um projeto na [OpenAI Platform](https://platform.openai.com/).
2. Crie uma chave em [API Keys](https://platform.openai.com/api-keys).
3. Configure orçamento, limites e alertas de uso.
4. Não cole a chave em código, GitHub, frontend ou documentação.

A [documentação oficial da OpenAI](https://developers.openai.com/api/docs/quickstart)
orienta criar uma chave e fornecê-la ao backend por variável de ambiente. As
[boas práticas de produção](https://developers.openai.com/api/docs/guides/production-best-practices)
recomendam guardar chaves fora do código e separar projetos de staging e
produção, com limites próprios.

### 7.2 Configurar pela interface — recomendado

1. Entre como `owner` ou `admin`.
2. Abra **Configurações**.
3. Na seção de IA, escolha `OpenAI`.
4. Informe a API key.
5. Escolha o modelo.
6. Configure esforço, verbosidade e limite máximo de saída.
7. Salve.

A chave é cifrada e armazenada por workspace. Ela não volta para o navegador.

O runtime atual tem como default `gpt-5.6-sol`. Para volume maior, avalie
`gpt-5.6-terra` ou `gpt-5.6-luna` com testes de qualidade, custo e latência. A
[página oficial de modelos](https://developers.openai.com/api/docs/models)
mantém os IDs e capacidades atuais.

### 7.3 Configuração global alternativa

Para uma chave gerenciada pelo operador do servidor:

```bash
sudoedit /opt/wal-chat/app/.env.production
```

```dotenv
OPENAI_API_KEY=CHAVE_DO_PROJETO
OPENAI_MODEL=gpt-5.6-sol
OPENAI_PROJECT=ID_DO_PROJETO_SE_APLICAVEL
OPENAI_ORGANIZATION=ID_DA_ORGANIZACAO_SE_APLICAVEL
```

Depois recrie `app`, `webhooks` e `scheduler`. A chave específica do workspace
tem prioridade sobre a chave global.

### 7.4 Testar

1. Abra **Agentes de IA**.
2. Crie uma persona curta e objetiva.
3. Adicione um documento de conhecimento.
4. Use o playground.
5. Confirme que o provedor retornado é `openai`, e não `demo`.
6. Verifique o rodapé `Responda PARAR`.
7. Confira custo e requisições na página de Usage.

O Wal Chat usa a Responses API com `store: false`, identificador de segurança
hash e limites de histórico e saída.

## 8. Configuração opcional do Gemini

1. Crie um projeto e uma chave no [Google AI Studio](https://aistudio.google.com/).
2. Prefira uma auth key e limite a chave ao Gemini API.
3. Em **Configurações**, selecione `Google`, informe a chave e um modelo com
   prefixo `gemini-`.
4. Salve e teste no playground.

A [documentação oficial do Gemini](https://ai.google.dev/gemini-api/docs/api-key)
orienta manter chaves no backend, não no frontend, e informa a transição para
auth keys. O nome esperado no ambiente global do Wal Chat é:

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=CHAVE_DO_GEMINI
```

## 9. Como usar cada módulo

### 9.1 Dashboard

Apresenta contas alcançadas, DMs, comentários, contatos e atividade. Na versão
implantada os números são demonstrativos. Não usar para faturamento, SLA ou
relatório de cliente até a tela consultar `dashboard_last_7_days` e insights
reais.

### 9.2 Inbox

1. Conecte uma conta Meta.
2. Receba uma DM ou comentário real de teste.
3. Use as abas Principal, Geral, Pedidos e IA off.
4. Observe o badge da janela de 24 horas.
5. Use **Sugerir com IA** somente depois de configurar um agente.
6. Revise a sugestão e envie manualmente durante a primeira validação controlada.
7. Use IA off para conversas que exigem atendimento humano.

O envio chama o backend, que recalcula compliance antes de chegar à Meta.

### 9.3 Contatos e tags

A tela atual usa contatos demonstrativos e exporta esse conjunto em CSV. O
banco já possui contatos, tags e relações reais recebidos pelo webhook, mas a
tela ainda precisa ser ligada ao backend antes de uso operacional.

### 9.4 Gatilhos

1. Abra **Gatilhos**.
2. Escolha a origem: comentário, DM ou story.
3. Defina palavra-chave e modo exato/contém.
4. Configure resposta única ou sequência.
5. Configure tag automática e cooldown.
6. Salve inicialmente como inativo.
7. Teste com uma conta de Instagram controlada.
8. Ative somente depois de revisar a resposta e o rodapé.

O worker processa inbound, evita duplicidade, registra cooldown e agenda o job.

### 9.5 Sequências

O **Automation Studio v2** permite montar chatbots em um canvas DAG com blocos
de mensagem/mídia, IA, espera, condição, teste A/B, ações de CRM, handoff
humano, evento n8n, subfluxo e encerramento.

1. Crie a jornada e selecione o ponto do canvas onde o bloco deve entrar.
2. Configure o bloco e suas rotas no Inspetor.
3. Valide o grafo; ciclos, nós órfãos, ramos ausentes e A/B diferente de 100%
   são recusados.
4. Salve o rascunho e publique uma versão imutável.
5. Escolha um contato controlado e execute. O scheduler ainda revalida 24h,
   opt-out, cooldown, blocklist, kill switches e idempotência.
6. Acompanhe a trilha de execução e o motivo exato de falha ou bloqueio.

Agente de IA precisa estar ativo e em modo **autônomo**; evento n8n exige a
assinatura `automation.node`; subfluxo precisa estar publicado. O servidor
valida essas referências novamente ao publicar.

O banco e o scheduler suportam passos, delays, enrollment e jobs. O editor
visual implantado ainda não persiste todo o fluxo. Não montar automações de
produção apenas pela interface atual.

### 9.6 Agentes de IA

1. Configure o provedor em **Configurações**.
2. Crie nome, persona, tom e limite de caracteres.
3. Comece em modo `copilot`.
4. Cadastre base de conhecimento com políticas, preços e perguntas frequentes.
5. Teste perguntas dentro e fora da base.
6. Verifique que o agente não inventa preço nem afirma ações externas.

O modo `autonomous` é armazenado, mas a versão implantada não deve ser tratada
como autoenvio geral: a geração acontece pelo endpoint de sugestão e o sender
Meta permanece uma fronteira separada.

### 9.7 Reengajamento

A versão atual oferece simulação e preview. Não executa campanha real completa.
Antes de implementar o sender:

- filtrar opt-out;
- recalcular 24h/7d por contato;
- limitar 30–45 por minuto;
- aplicar retries e idempotência;
- permitir pausa e cancelamento;
- registrar auditoria por destinatário.

### 9.8 Calendário e agendamento

O calendário é persistente e operacional. Ele apresenta eventos, tarefas,
agendamentos, conteúdo, campanhas, sequências, jobs e atividades com dia/hora.
Também possui OAuth Google com Calendar, Meet, Tasks, sync incremental e
Free/Busy.

Operação inicial:

1. configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e a redirect URI;
2. conecte uma conta em **Calendário > Conectar Google**;
3. escolha o calendário e a lista do Tasks;
4. crie e sincronize um evento controlado com Meet;
5. crie um link público e teste reserva/conflito em janela anônima;
6. vincule a agenda a um gatilho ou agente somente após o teste.

O passo a passo completo está em
[Google Calendar, Meet e Tasks](CONFIGURACAO_GOOGLE_CALENDAR.md).

### 9.9 Publicar e Auto-like

Continuam protótipos visuais. Não representam execução completa pela API Meta.
Não prometer publicação de Feed, Reel, Story, carrossel ou auto-like até
concluir integração, testes e permissões específicas.

### 9.10 Insights

Gráficos e heatmap atuais são demonstrativos. É necessário alimentar
`insights_daily` e trocar o frontend para consultas do workspace.

## 10. Operação do servidor

### 10.1 Estado dos serviços

```bash
sudo docker compose \
  --project-directory /opt/wal-chat/app \
  --env-file /opt/wal-chat/app/.env.production \
  -f /opt/wal-chat/app/docker-compose.production.yml \
  ps
```

Serviços esperados:

- `wal-chat-app-1`;
- `wal-chat-webhooks-1`;
- `wal-chat-scheduler-1`;
- `wal-chat-redis-1`;
- contêineres `supabase_*_wal_chat_prod`.

### 10.2 Logs

```bash
sudo docker compose \
  --project-directory /opt/wal-chat/app \
  --env-file /opt/wal-chat/app/.env.production \
  -f /opt/wal-chat/app/docker-compose.production.yml \
  logs --no-color --tail=200 app webhooks scheduler redis
```

Nunca cole logs completos em chamados públicos sem procurar tokens, e-mails e
payloads pessoais.

### 10.3 Reinício controlado

```bash
sudo docker compose \
  --project-directory /opt/wal-chat/app \
  --env-file /opt/wal-chat/app/.env.production \
  -f /opt/wal-chat/app/docker-compose.production.yml \
  restart app webhooks scheduler
```

### 10.4 Health check

```bash
curl -fsS https://wal-chat.64.181.178.125.nip.io/api/health
```

O health atual verifica presença de configuração e processo HTTP. O endpoint
`/api/ready` ainda não está na imagem implantada. Por isso, um health verde não
substitui smoke test de autenticação, banco, fila e worker.

### 10.5 Backup e rollback da correção de rede

O estado anterior à correção de 17/08/2026 está em:

```text
/opt/wal-chat/backups/20260817-access-fix
```

Não restaure esse backup sem diagnóstico: ele contém a URL interna antiga do
Supabase, que causava `ECONNREFUSED` no backend.

## 11. Testes obrigatórios

### 11.1 Smoke técnico em demo

```bash
docker exec -e SMOKE_APP_URL=http://127.0.0.1:3000 \
  wal-chat-app-1 node scripts/smoke.mjs
```

Resultado esperado:

```text
health: ok
auth: ok
rls: ok
webhookVerification: ok
webhookSignature: ok
queue: bullmq
worker: ok
scheduler: ok
```

O smoke cria dados técnicos. Executar somente no workspace demo e nunca com uma
conta Meta real ligada a uma automação ativa.

### 11.2 Teste Meta controlado

1. Use um workspace de teste ou mantenha os gates externos fechados.
2. Conecte somente uma conta Instagram controlada.
3. Valide permissões e webhooks.
4. Envie uma DM de uma segunda conta controlada.
5. Confirme inbound e janela de 24h.
6. Gere sugestão de IA.
7. Valide texto, opt-out e blocklist.
8. Só então teste uma resposta manual.
9. Teste `PARAR` e confirme o bloqueio posterior.
10. Teste comentário e confirme uma única Private Reply.

## 12. Checklist para ativar um novo workspace ou campanha

A infraestrutura atual já opera com `DEMO_MODE=false`. Antes de habilitar gates
externos para um novo tenant ou iniciar uma campanha, aprove todos os itens:

- [ ] domínio próprio definitivo, em vez de depender apenas de `nip.io`;
- [ ] SMTP transacional e confirmação de e-mail;
- [ ] contas nominais com MFA e recuperação;
- [ ] Meta Business verificado quando exigido;
- [ ] App Review/Advanced Access das permissões usadas;
- [ ] conta Instagram Professional conectada e validada;
- [ ] webhook real recebido e auditado;
- [ ] renovação de token monitorada;
- [ ] OpenAI ou Gemini configurado com orçamento e limites;
- [ ] dashboard, contatos e insights ligados ao banco real;
- [ ] sequências persistidas e testadas;
- [ ] campanhas e publicação implementadas de ponta a ponta;
- [ ] rate limiting e observabilidade revisados;
- [ ] backups de banco testados com restauração;
- [ ] política, termos e exclusão revisados juridicamente;
- [ ] teste de opt-out, 24h, 7d, cooldown e Private Reply;
- [ ] piloto com pequena lista interna;
- [ ] kill switch e procedimento de incidente documentados.

Em uma instalação nova que ainda esteja em demo, a mudança de `DEMO_MODE` exige
release versionada, backup, reconstrução dos três processos Node e repetição do
checklist externo. Não edite a release ativa de produção no lugar.

## 13. Solução de problemas

### Login falha

- confirme que não foi usado o botão Demo;
- confira login e senha no cofre;
- teste `https://api-wal-chat.64.181.178.125.nip.io/auth/v1/settings`;
- confira `supabase_auth_wal_chat_prod`;
- não tente recuperar senha `.local` por e-mail.

### Configurações diz que Meta não está pronta

- confirme `META_APP_ID` e `META_APP_SECRET`;
- confira a URI OAuth exata, incluindo HTTPS e caminho;
- confirme `CREDENTIALS_ENCRYPTION_KEY`;
- recrie o contêiner após alterar o ambiente;
- valide a conta pela própria tela.

### Webhook retorna 403

O verify token cadastrado na Meta não coincide com `META_VERIFY_TOKEN`.

### Webhook retorna 401

A assinatura `X-Hub-Signature-256` não confere com o corpo bruto e o App Secret.

### IA responde como demo

Nenhuma chave real está disponível para o workspace ou servidor. Salve a chave
na tela de Configurações e confira novamente o status.

### Envio aparece bloqueado

Consultar o motivo de compliance: opt-out, ausência de inbound, fora de 24h,
fora de 7d, cooldown, comentário já respondido, janela de Private Reply ou
conteúdo bloqueado.

### Backend não alcança Supabase

Os contêineres Node devem participar das redes `wal-chat-internal` e
`supabase_network_wal_chat_prod`. `SUPABASE_URL` deve usar:

```text
http://api.supabase.internal:8000
```

Não publique a porta Postgres para resolver conectividade interna.

## 14. Segurança e gestão de credenciais

- nunca adicionar `Acessos Privados` ao Git;
- nunca imprimir `.env.production` em logs;
- usar `sudoedit`, não copiar segredos para comandos salvos no histórico;
- manter SSH somente por chave;
- criar uma chave SSH dedicada ao Wal Chat antes do Live Mode;
- rotacionar contas técnicas após troca de equipe;
- usar contas nominais no trabalho diário;
- guardar tokens Meta e IA somente cifrados no backend;
- revogar imediatamente uma chave suspeita e auditar uso;
- separar projetos OpenAI de homologação e produção;
- limitar gastos e taxa nos provedores de IA;
- revisar usuários `owner/admin` mensalmente.

## 15. Resumo executivo

O Wal Chat possui uma base técnica real para autenticação, RLS, Meta OAuth,
webhooks, Inbox, gatilhos, IA, filas e compliance. O ambiente voltou a passar o
smoke test completo em modo demo. Porém, parte relevante das telas de produto
ainda é demonstrativa ou protótipo. O caminho seguro é configurar Meta e IA,
validar Inbox/gatilhos com contas de teste e, em paralelo, concluir a ligação ao
banco dos módulos analíticos e de execução antes de qualquer campanha real.
