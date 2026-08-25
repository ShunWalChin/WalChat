# Validação Meta em produção — 24/08/2026

## Objetivo

Este documento registra a configuração e a validação do Instagram Professional e
do WhatsApp Business no ambiente publicado do Wal Chat. Nenhum segredo, token de
acesso ou chave criptográfica é documentado no repositório.

Ambiente validado:

- aplicação: `https://wal-chat.64.181.178.125.nip.io`;
- release ativa: `/opt/wal-chat/releases/20260824-meta-instagram-fix-v1`;
- branch: `codex/backend-core-hardening`;
- commits principais: `7fc7934`, `6dedffb` e `11d6848`.

## Parecer executivo

| Integração                 | Estado                           | Evidência                                                                                                  |
| -------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Instagram Professional     | Conectado e validado             | `@walfredonetto`, token cifrado, permissões e webhooks validados pela aplicação                            |
| Webhook do Instagram       | Operacional                      | callback HTTPS, challenge e assinatura HMAC habilitados                                                    |
| WhatsApp Embedded Signup   | Configurado, bloqueado pela Meta | wizard abre com o `config_id` oficial; a Meta recusa onboarding enquanto o provedor não estiver verificado |
| Webhook do WhatsApp        | Operacional                      | callback validado, campo `messages` assinado e teste oficial recebido                                      |
| WABA/número de teste       | Criados                          | ativos de teste disponíveis no painel da Meta                                                              |
| WABA/número real           | Pendente de onboarding           | exige seleção/criação pelo titular no popup da Meta                                                        |
| App Review/Advanced Access | Pendente externo                 | depende da verificação empresarial e das evidências exigidas pela Meta                                     |
| Disparos externos          | Bloqueados por segurança         | `DEMO_MODE=true` até a conclusão dos gates de go-live                                                      |

O Instagram está pronto para o primeiro ciclo controlado de testes reais. O
WhatsApp está tecnicamente integrado, mas só deve enviar para usuários externos
depois que o titular concluir o Embedded Signup, verificar o número, configurar
pagamento quando aplicável e obter as permissões necessárias.

No teste real do Embedded Signup, a Meta retornou **“WalOnTheRoad não pode
integrar clientes no momento”**. O painel confirmou a causa: o portfólio
`WalOnTheRoad` está **Não verificado**, e a Verificação do Acesso como provedora
de tecnologia fica desabilitada até a aprovação da Verificação da Empresa.

## Ativos públicos configurados

Esses identificadores não são credenciais secretas:

- app principal Meta/WhatsApp: `2503807193454662`;
- app Instagram: `1369166301463722`;
- portfólio empresarial WalOnTheRoad: `206930247736358`;
- configuração do WhatsApp Embedded Signup: `1384774706505557`;
- redirect OAuth: `https://wal-chat.64.181.178.125.nip.io/configuracoes`;
- webhook Instagram: `https://wal-chat.64.181.178.125.nip.io/api/public/webhooks/instagram`;
- webhook WhatsApp: `https://wal-chat.64.181.178.125.nip.io/api/public/webhooks/whatsapp`;
- domínio permitido para o JavaScript SDK: `wal-chat.64.181.178.125.nip.io`.

No Login for Business estão habilitados o OAuth em navegador incorporado e o
login pelo JavaScript SDK. O modelo usado no WhatsApp é a configuração oficial
de cadastro incorporado com token de 60 dias.

## Validação funcional executada

### Instagram

1. O usuário aceitou o papel de tester do Instagram.
2. O OAuth retornou à URL de produção sem expor tokens no navegador.
3. O backend trocou o código, consultou o perfil e cifrou a credencial por tenant.
4. O tipo retornado pela API (`MEDIA_CREATOR`) foi normalizado para o domínio
   interno canônico (`CREATOR`).
5. O sistema exibiu `@walfredonetto` como conectado.
6. O comando **Testar token e assinaturas** confirmou token, perfil e webhooks.
7. A conta apresentou recursos de mensagens, comentários, publicação e insights.

### WhatsApp

1. Os termos de Technology Provider foram aceitos pelo titular.
2. O callback HTTPS e o verify token foram validados no painel da Meta.
3. O campo `messages` foi assinado e o evento oficial de teste chegou ao backend.
4. A configuração oficial do Embedded Signup foi criada e persistida no backend.
5. O domínio e a URL de redirecionamento de produção foram autorizados.
6. O botão **Conectar WhatsApp** abriu o fluxo oficial com o `config_id` correto.
7. WABA e telefone de teste foram criados para homologação.

O processo oficial de Verificação da Empresa foi iniciado com o país `Brasil` e
deixado aberto na seleção do tipo jurídico da empresa. O término da verificação e
do onboarding do WABA real é uma ação assistida do titular porque a Meta solicita
classificação jurídica, nome, endereço, telefone, e-mail, site, confirmação de
contato e possivelmente documentos. Também pode solicitar senha, autenticação em
dois fatores, confirmação do telefone ou forma de pagamento. Esses dados não
devem ser inventados nem automatizados pelo Wal Chat.

## Qualidade e saúde do ambiente

- testes automatizados: **91/91 aprovados**, em 25 arquivos;
- TypeScript e lint: aprovados;
- build de produção: aprovado;
- serviços `app`, `webhooks`, `scheduler` e `redis`: saudáveis;
- `/api/ready`: aplicação, Supabase e Redis operacionais;
- integrações detectadas: Meta, Instagram, WhatsApp e cifragem de credenciais;
- IA OpenAI/Gemini e Google Workspace permanecem sem credenciais no ambiente.

O deploy utiliza exclusivamente:

```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d
```

Não combinar o arquivo de desenvolvimento `docker-compose.yml` com o de
produção. A combinação publica portas locais e pode gerar conflito com outros
containers do servidor.

## Controles de segurança mantidos

- app secrets, tokens e verify tokens ficam apenas no backend;
- credenciais de tenant são cifradas antes da persistência;
- webhooks validam `X-Hub-Signature-256` com HMAC SHA-256;
- callbacks OAuth usam estado e validação de origem;
- diagnósticos de OAuth retornam apenas códigos de etapa, sem mensagens cruas da
  Meta ou material sensível;
- a janela de 24 horas, elegibilidade, cooldown, opt-out e blocklist passam pelo
  gateway central antes do envio;
- disparos externos continuam desligados enquanto `DEMO_MODE=true`.

## Gates restantes para WhatsApp real

1. Concluir a Verificação da Empresa com classificação, dados e documentos reais.
2. Solicitar e obter a Verificação do Acesso como provedora de tecnologia.
3. Reabrir e concluir o fluxo **Continuar como Walfredo Figueiredo Neto**.
4. Selecionar ou criar o Business Portfolio e a conta WhatsApp Business reais.
5. Cadastrar e verificar um telefone que possa receber o código da Meta.
6. Configurar a forma de pagamento, caso a Meta a solicite.
7. Gravar as evidências para App Review (envio de mensagem e criação de template).
8. Solicitar Advanced Access para as permissões usadas pela aplicação.
9. Validar templates aprovados, limites, quality rating e webhook com tráfego real.
10. Executar um piloto com contatos consentidos e volume mínimo.
11. Somente então alterar `DEMO_MODE=false` e repetir o smoke test.

## Critério para liberar o live mode

A mudança para live exige todos os itens abaixo simultaneamente:

- WABA e número reais visíveis no diagnóstico do Wal Chat;
- status do telefone `CONNECTED` e qualidade aceitável;
- token válido e armazenado cifrado;
- webhook real recebido e processado uma única vez;
- permissões aprovadas para o caso de uso;
- template necessário aprovado;
- opt-in comprovável para os contatos do piloto;
- backup, alertas, logs e rollback testados;
- aceite explícito do responsável pela operação.

Até lá, o estado correto é **Instagram real conectado + WhatsApp em onboarding +
disparos externos bloqueados**. Isso representa um gate de segurança, não uma
falha da integração.

## Rollback

Releases anteriores disponíveis no servidor:

- `/opt/wal-chat/releases/20260824-meta-oauth-diagnostic-v1`;
- `/opt/wal-chat/releases/20260823-meta-prod-v1`;
- `/opt/wal-chat/releases/20260823-n8n-wizard-v1`.

O rollback deve apontar o symlink da aplicação para uma release validada e subir
novamente apenas `docker-compose.production.yml` com `.env.production`.

## Referências oficiais

- [WhatsApp Embedded Signup — visão geral](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
- [WhatsApp Embedded Signup — implementação](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Getting started for technology providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
