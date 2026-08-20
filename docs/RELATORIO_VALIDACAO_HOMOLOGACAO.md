# Wal Chat - Relatório de validação da homologação

Data: 21 de julho de 2026
Ambiente: `https://wal-chat.64.181.178.125.nip.io`

> **Status em 30/07/2026:** este documento preserva a evidência histórica de 21/07, mas não representa uma aprovação atual de go-live. Uma revalidação somente leitura encontrou o scheduler sem acesso ao Supabase a partir do container e confirmou que o ambiente segue em `DEMO_MODE=true`. A correção de rede, readiness e healthchecks foi preparada na branch `agent/production-hardening-sprint-0`, mas ainda não foi implantada.

## Resultado executivo

Na data original, a homologação estava acessível por HTTPS, utilizava uma instância Supabase isolada e passou pelos testes automatizados, smoke test de backend e verificação interativa no navegador. Esses resultados são uma fotografia daquele momento, não uma garantia contínua.

## Infraestrutura

| Verificação                 | Resultado                                                                       |
| --------------------------- | ------------------------------------------------------------------------------- |
| Aplicação TanStack Start    | Aprovado; container saudável                                                    |
| Redis/BullMQ exclusivo      | Aprovado; container saudável                                                    |
| Worker de webhooks          | Aprovado; sem erros nos logs                                                    |
| Scheduler                   | Aprovado; processou job até `completed`                                         |
| Supabase `wal_chat_prod`    | Aprovado; containers e volumes exclusivos                                       |
| RLS e GRANTs                | Aprovado pelo smoke test                                                        |
| Nginx/HTTPS                 | Aprovado                                                                        |
| Certificado                 | Válido até 19/10/2026; renovação automática                                     |
| Schema lint                 | `No schema errors found`                                                        |
| Isolamento de portas        | App `4194`; Supabase `54351`–`54359`; portas antigas encerradas                 |
| Superfícies administrativas | Portas Supabase bloqueadas externamente pela rede; Studio somente por túnel SSH |

## Migração da marca

- Interface, metadados, dados seed, conta demo, arquivos exportados, schema, containers, rede, volumes, projeto Supabase, domínios, cartão social e documentação usam **Wal Chat**.
- A aplicação ativa está em `/opt/wal-chat`; uma auditoria textual não encontrou referências à marca anterior nessa árvore.
- A stack anterior foi parada sem apagar volumes ou banco, preservando rollback controlado.
- Os endereços anteriores respondem HTTP `301` para os novos domínios Wal Chat, mantendo caminhos e parâmetros.

## Backend e compliance

| Cenário                                 | Resultado                                |
| --------------------------------------- | ---------------------------------------- |
| Health check                            | Aprovado                                 |
| Login com usuário Supabase              | Aprovado                                 |
| Workspace visível somente ao membro     | Aprovado                                 |
| Contatos bloqueados para `anon`         | Aprovado                                 |
| Verificação GET do webhook Meta         | Aprovado                                 |
| Assinatura HMAC SHA-256 válida          | Aprovado                                 |
| Assinatura inválida retorna 401         | Aprovado                                 |
| Evento entra no BullMQ                  | Aprovado                                 |
| Worker ingere contato/comentário        | Aprovado                                 |
| Gatilho agenda sequência                | Aprovado                                 |
| Scheduler conclui etapa                 | Aprovado                                 |
| Rodapé `Responda PARAR`                 | Aprovado nos fluxos automáticos testados |
| Cooldown, opt-out e Private Reply único | Cobertos pela suíte de compliance        |

Resultado do smoke test:

```json
{
  "health": "ok",
  "auth": "ok",
  "rls": "ok",
  "webhookVerification": "ok",
  "webhookSignature": "ok",
  "queue": "bullmq",
  "worker": "ok",
  "scheduler": "ok"
}
```

## Rotas

As 16 rotas abaixo responderam HTTP 200:

- `/`
- `/dashboard`
- `/inbox`
- `/contatos`
- `/gatilhos`
- `/sequencias`
- `/agentes`
- `/reengajamento`
- `/calendario`
- `/publicar`
- `/auto-like`
- `/insights`
- `/configuracoes`
- `/privacidade`
- `/termos`
- `/exclusao-de-dados`

## Verificação interativa

| Módulo              | Verificação realizada                                          | Resultado                                                                 |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Autenticação        | Login com usuário real do Supabase                             | Aprovado                                                                  |
| Identidade Wal Chat | Marca, monograma `W`, conta `@wal.chat`, título e usuário demo | Aprovado                                                                  |
| Dashboard           | Renderização após login                                        | Aprovado                                                                  |
| Inbox               | Abas e geração de sugestão                                     | Aprovado                                                                  |
| IA na Inbox         | Sugestão contém `Responda PARAR`                               | Aprovado                                                                  |
| Contatos            | Lista, tags, elegibilidade e acionamento da exportação CSV     | Aprovado; o navegador automatizado não expôs o evento de download do Blob |
| Gatilhos            | Desativar e restaurar switch                                   | Aprovado                                                                  |
| Sequências          | Adicionar bloco de texto                                       | Aprovado                                                                  |
| Agentes             | Playground gera resposta e opt-out sem enviar ao Instagram     | Aprovado                                                                  |
| Reengajamento       | Preview de 235 elegíveis e taxa segura                         | Aprovado                                                                  |
| Publicar            | Alternar Story/Carrossel e gerar copy                          | Aprovado                                                                  |
| Auto-like           | Selecionar modo por palavra-gatilho                            | Aprovado                                                                  |
| Calendário          | Renderização de mês/semana e cards arrastáveis                 | Aprovado visualmente                                                      |
| Insights            | Gráficos, heatmap, top posts e análise                         | Aprovado visualmente                                                      |
| Páginas legais      | Privacidade, Termos e Exclusão de Dados                        | Aprovado                                                                  |

Nenhum erro ou warning foi registrado no console durante a navegação final dos módulos.

## Validação da refatoração Meta/OpenAI

Em 21/07/2026, a camada de integrações foi ampliada e validada localmente e na homologação:

| Verificação                         | Resultado                                                 |
| ----------------------------------- | --------------------------------------------------------- |
| TypeScript `npx tsc --noEmit`       | Aprovado, zero erros                                      |
| ESLint `npm run lint`               | Aprovado, zero erros/warnings                             |
| Vitest `npm test`                   | 5 arquivos e 18 testes aprovados                          |
| Build cliente + SSR `npm run build` | Aprovado                                                  |
| PostgreSQL `npm run db:lint`        | Aprovado, zero erros de schema                            |
| Recriação local `npm run db:reset`  | Não executada nesta máquina: Docker Desktop estava parado |
| Backup pré-migração                 | Aprovado; código, schema e dados preservados no servidor  |
| Migration `20260721180000`          | Aplicada sem reset e aprovada na instância de homologação |
| Redis/BullMQ                        | Aprovado com política `noeviction`                        |

A suíte cobre HMAC, criptografia autenticada, OAuth e troca de token, assinatura de campos, janelas 24h/7d, Private Reply única, HUMAN_AGENT, cooldown, blocklist, opt-out e canais que podem ou não renovar a janela. O reset local não foi substituído por uma afirmação simulada. No servidor isolado, a migration foi aplicada sem reset depois dos backups e validada pelos smokes autenticados, pelo build e pelos logs dos serviços.

O smoke autenticado complementar (`scripts/smoke-integrations.mjs`) valida status Meta sanitizado, configuração de IA, agentes, sugestão com opt-out, Inbox, gatilhos e rejeição de acesso anônimo. Ele não substitui o teste externo com credenciais reais.

Resultado do smoke autenticado das integrações:

```json
{
  "privateApiAuth": "ok",
  "metaStatus": "ok",
  "aiSettings": "ok",
  "agentsCrud": "ok",
  "knowledgeCrud": "ok",
  "aiSuggestion": "demo",
  "inbox": "ok",
  "triggers": "ok"
}
```

Os backups de homologação foram preservados em `/opt/wal-chat/backups`. Na validação de 21/07, a aplicação, o worker, o scheduler e o Redis estavam ativos e os logs finais não apresentavam erros. A interface também foi corrigida para só indicar uma conta Meta como conectada quando o token criptografado correspondente realmente existe.

## Revalidação local de hardening — 30/07/2026

| Verificação                                | Resultado                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Formato, TypeScript e ESLint 10            | Aprovado                                                                |
| Vitest                                     | 9 arquivos e 27 testes aprovados                                        |
| Build cliente + SSR                        | Aprovado                                                                |
| Auditoria npm completa e de produção       | Aprovado; zero vulnerabilidades conhecidas                              |
| Imagem Docker Linux                        | Construída e executada no WSL                                           |
| `/api/health`                              | Liveness `200`                                                          |
| `/api/ready` sem dependências em modo demo | `200`, com dependências explicitamente `not_configured`                 |
| Cabeçalhos HTTP de segurança               | CSP, Permissions-Policy, Referrer-Policy, nosniff e anti-framing ativos |
| Deploy da correção                         | Não executado; exige aprovação específica                               |

Ainda precisam de validação no ambiente integrado: readiness com Supabase e Redis reais, heartbeats dos dois workers, smoke autenticado, migrações, backup/restore e todos os fluxos externos com Meta/OpenAI.

## Dependências externas pendentes

O ambiente continua em `DEMO_MODE=true`. Os itens abaixo exigem contas e credenciais que não foram fornecidas:

- App Meta com permissões aprovadas e Advanced Access.
- Tokens reais do Instagram Graph API.
- Teste do OAuth já implementado com App ID/secret e conta Professional reais.
- Chave OpenAI ou Gemini e política de orçamento.
- SMTP de produção para confirmação e recuperação de senha.

Publicação, disparos reais, insights reais e geração por IA não devem ser marcados como produção ativa antes dessas configurações externas e da matriz em `CONFIGURACAO_META_E_OPENAI.md`.

## Integração multicanal Meta — 20/08/2026

A release `20260820-meta-multichannel-v1`, commit `5fcd9cd`, foi implantada na
stack isolada `wal-chat` com `DEMO_MODE=true`. O banco foi copiado para uma
database temporária, as três migrations foram executadas nessa cópia e a
database de ensaio foi descartada antes da aplicação em homologação.

| Verificação | Resultado |
| --- | --- |
| Backup PostgreSQL pré-migração | Aprovado; dump em `/opt/wal-chat/backups/20260820-meta-multichannel-pre/` |
| Migrations `20260820210000` a `20260820212000` | Aprovadas primeiro em database isolada e depois em homologação |
| Tabelas/RPCs WhatsApp | Contas, templates, ingestão transacional e status monotônico presentes |
| Testes unitários | 20 arquivos e 60 testes aprovados |
| TypeScript, ESLint, Prettier e build SSR | Aprovados |
| Auditoria npm | Zero vulnerabilidades conhecidas |
| Challenge do webhook WhatsApp | `200`, challenge preservado |
| POST com HMAC inválido | `401` |
| POST com HMAC válido | `200`, aceito pela BullMQ e marcado `processed` pelo worker |
| Smoke público | 19 rotas e health aprovados |
| Smoke autenticado | Meta, IA, Inbox, Contatos, Dashboard, Gatilhos, Go-Live e observabilidade aprovados |
| Serviços | App, worker de webhooks, scheduler e Redis saudáveis |
| Kill switches | Disparos externos, Comment-to-DM e IA autônoma desligados |
| Layout público | Sem overflow horizontal em 1440×900 e 375×812; console sem erros |

O código está operacional, mas a habilitação real continua bloqueada de forma
intencional. Ainda faltam o `META_APP_ID`, o Configuration ID do Embedded
Signup, um telefone/WABA conectado e Advanced Access aprovado pela Meta. A
conta Instagram já cadastrada não foi usada para disparos durante esta
validação. Nenhum token, PIN ou secret foi registrado no relatório.
