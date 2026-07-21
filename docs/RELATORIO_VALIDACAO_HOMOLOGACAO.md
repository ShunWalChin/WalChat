# Wal Chat - Relatório de validação da homologação

Data: 21 de julho de 2026
Ambiente: `https://wal-chat.64.181.178.125.nip.io`

## Resultado executivo

A homologação está acessível por HTTPS, utiliza uma instância Supabase isolada e passou pelos testes automatizados, smoke test de backend e verificação interativa no navegador.

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

Em 21/07/2026, a camada de integrações foi ampliada e validada localmente:

| Verificação                         | Resultado                                                 |
| ----------------------------------- | --------------------------------------------------------- |
| TypeScript `npx tsc --noEmit`       | Aprovado, zero erros                                      |
| ESLint `npm run lint`               | Aprovado, zero erros/warnings                             |
| Vitest `npm test`                   | 5 arquivos e 18 testes aprovados                          |
| Build cliente + SSR `npm run build` | Aprovado                                                  |
| PostgreSQL `npm run db:lint`        | Aprovado, zero erros de schema                            |
| Recriação `npm run db:reset`        | Não executada nesta máquina: Docker Desktop estava parado |

A suíte cobre HMAC, criptografia autenticada, OAuth e troca de token, assinatura de campos, janelas 24h/7d, Private Reply única, HUMAN_AGENT, cooldown, blocklist, opt-out e canais que podem ou não renovar a janela. O reset não foi substituído por uma afirmação simulada; ele deve ser repetido em WSL/servidor com Docker ativo antes de aplicar a migration em produção.

## Dependências externas pendentes

O ambiente continua em `DEMO_MODE=true`. Os itens abaixo exigem contas e credenciais que não foram fornecidas:

- App Meta com permissões aprovadas e Advanced Access.
- Tokens reais do Instagram Graph API.
- Teste do OAuth já implementado com App ID/secret e conta Professional reais.
- Chave OpenAI ou Gemini e política de orçamento.
- SMTP de produção para confirmação e recuperação de senha.

Publicação, disparos reais, insights reais e geração por IA não devem ser marcados como produção ativa antes dessas configurações externas e da matriz em `CONFIGURACAO_META_E_OPENAI.md`.
