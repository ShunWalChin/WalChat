# Mapa do código

Este documento funciona como índice de manutenção. Os comentários nos arquivos explicam a lógica local; aqui está a responsabilidade de cada parte e sua relação com o restante do sistema.

## Raiz e build

| Arquivo                         | Responsabilidade                                             |
| ------------------------------- | ------------------------------------------------------------ |
| `package.json`                  | Dependências e comandos de desenvolvimento, teste e produção |
| `package-lock.json`             | Resolução reproduzível de dependências npm                   |
| `tsconfig.json`                 | TypeScript e aliases usados pelo projeto                     |
| `tsr.config.json`               | Geração da árvore de rotas TanStack                          |
| `vite.config.ts`                | Plugins React, TanStack Start, Tailwind e devtools           |
| `eslint.config.js`              | Regras de lint e exclusão do arquivo gerado                  |
| `prettier.config.js`            | Formatação do repositório                                    |
| `.env.example`                  | Contrato de configuração sem secrets reais                   |
| `.dockerignore`                 | Reduz contexto e impede secrets no build Docker              |
| `Dockerfile`                    | Build multi-stage e runtime Node não-root                    |
| `docker-compose.yml`            | Redis local                                                  |
| `docker-compose.production.yml` | App, dois workers e Redis isolados                           |

## Bootstrap, layout e sessão

| Arquivo                         | Responsabilidade                              |
| ------------------------------- | --------------------------------------------- |
| `src/router.tsx`                | Cria o router e registra tipagem TanStack     |
| `src/routeTree.gen.ts`          | Árvore gerada automaticamente; não editar     |
| `src/routes/__root.tsx`         | Metadados, fontes, manifest e documento HTML  |
| `src/routes/index.tsx`          | Login, cadastro e entrada no modo demo        |
| `src/routes/_app.tsx`           | Layout pai autenticado                        |
| `src/contexts/auth-context.tsx` | Sessão Supabase e fallback demo local         |
| `src/components/app-shell.tsx`  | Sidebar, navegação, header e proteção de rota |
| `src/components/ui.tsx`         | Componentes visuais compartilhados            |
| `src/styles.css`                | Design system urbano e responsividade         |

## Páginas legais

| Arquivo                            | Responsabilidade                     |
| ---------------------------------- | ------------------------------------ |
| `src/components/legal-page.tsx`    | Layout uniforme de documentos legais |
| `src/routes/privacidade.tsx`       | Política de Privacidade/LGPD         |
| `src/routes/termos.tsx`            | Termos de Uso                        |
| `src/routes/exclusao-de-dados.tsx` | Instruções e confirmação de exclusão |

## Módulos do produto

| Arquivo                             | Responsabilidade                                 |
| ----------------------------------- | ------------------------------------------------ |
| `src/routes/_app/dashboard.tsx`     | KPIs, gráfico, atividade e atalhos               |
| `src/routes/_app/inbox.tsx`         | Abas, conversa, janela Meta e sugestão de IA     |
| `src/routes/_app/contatos.tsx`      | Contatos, tags, busca e CSV                      |
| `src/routes/_app/gatilhos.tsx`      | Regras por palavra/origem e estado               |
| `src/routes/_app/sequencias.tsx`    | Editor de blocos e delays                        |
| `src/routes/_app/agentes.tsx`       | CRUD real de personas, conhecimento e playground |
| `src/routes/_app/reengajamento.tsx` | Segmentação, elegibilidade e preview             |
| `src/routes/_app/calendario.tsx`    | Agenda mês/semana e drag-and-drop                |
| `src/routes/_app/publicar.tsx`      | Tipos de post, copy e preview Instagram          |
| `src/routes/_app/auto-like.tsx`     | Modos de curtida automática                      |
| `src/routes/_app/insights.tsx`      | Crescimento, heatmap, posts e leitura IA         |
| `src/routes/_app/configuracoes.tsx` | OAuth Instagram, diagnóstico e provedor de IA    |
| `src/lib/demo-data.ts`              | Fixtures visuais do MVP em modo demo             |

## API

| Arquivo                                       | Responsabilidade                            |
| --------------------------------------------- | ------------------------------------------- |
| `src/routes/api/health.ts`                    | Saúde e presença de configuração            |
| `src/routes/api/public/webhooks/instagram.ts` | Challenge, HMAC, parse e fila               |
| `src/routes/api/integrations/meta/*.ts`       | OAuth, status, validação e desconexão Meta  |
| `src/routes/api/ai/settings.ts`               | Provedor/modelo e chave cifrada             |
| `src/routes/api/ai/agents.ts`                 | CRUD autenticado de agentes                 |
| `src/routes/api/ai/knowledge.ts`              | CRUD autenticado de conhecimento            |
| `src/routes/api/ai/suggest.ts`                | Sugestão a partir do agente salvo           |
| `src/routes/api/inbox.ts`                     | Conversas/mensagens reais e estado da Inbox |
| `src/routes/api/triggers.ts`                  | CRUD dos gatilhos processados pelo worker   |
| `src/routes/api/messages/send.ts`             | Envio humano com compliance                 |
| `src/routes/api/compliance/check.ts`          | Prévia do motor de elegibilidade            |
| `src/routes/api/data-deletion.ts`             | Signed request de exclusão Meta             |

## Domínio no backend

| Arquivo                                        | Responsabilidade                                 |
| ---------------------------------------------- | ------------------------------------------------ |
| `src/server/env.server.ts`                     | Schema Zod de variáveis do servidor              |
| `src/server/compliance.ts`                     | Regra pura de envio Meta-safe                    |
| `src/server/meta-sender.server.ts`             | DMs e Private Replies após decisão               |
| `src/server/ai.server.ts`                      | OpenAI Responses/Gemini, agente e opt-out        |
| `src/server/api-auth.server.ts`                | JWT, membership, RBAC, Origin e erros HTTP       |
| `src/server/credentials-crypto.server.ts`      | AES-256-GCM dos secrets por tenant               |
| `src/server/integration-credentials.server.ts` | Store cifrado e auditoria de integrações         |
| `src/server/meta-api.server.ts`                | OAuth, perfil, subscribed_apps e refresh Meta    |
| `src/server/supabase-admin.server.ts`          | Cliente service role e validação de bearer token |
| `src/server/webhook-signature.server.ts`       | Assinatura e comparação HMAC constant-time       |
| `src/server/queue.server.ts`                   | Persistência idempotente e enqueue BullMQ        |
| `src/server/webhook-processor.server.ts`       | Normalização, contatos, gatilhos e jobs          |

## Workers

| Arquivo                           | Responsabilidade                                |
| --------------------------------- | ----------------------------------------------- |
| `src/workers/instagram.worker.ts` | Consome e processa eventos da fila              |
| `src/workers/scheduler.worker.ts` | Lock, envio, auditoria, retry e próximos passos |

## Testes e ferramentas

| Arquivo                                 | Responsabilidade                              |
| --------------------------------------- | --------------------------------------------- |
| `src/server/compliance.test.ts`         | Janela, opt-out, HUMAN_AGENT e cooldown       |
| `src/server/credentials-crypto.test.ts` | Round-trip e adulteração do envelope cifrado  |
| `src/server/meta-api.test.ts`           | OAuth, token e assinatura de campos Meta      |
| `src/server/webhook-processor.test.ts`  | Fontes que podem abrir a janela de 24h        |
| `src/server/webhook-signature.test.ts`  | HMAC válido e payload adulterado              |
| `scripts/smoke.mjs`                     | Teste integrado Auth/RLS/webhook/fila/workers |
| `scripts/validate-routes.mjs`           | HTTP 200 nas 16 rotas e health                |
| `scripts/server.mjs`                    | Adapter Node de produção e arquivos estáticos |
| `scripts/generate-manual-pdf.py`        | Gera o manual PDF a partir do Markdown        |

## Banco

| Arquivo                                                           | Responsabilidade                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| `supabase/config.toml`                                            | Serviços, portas e Auth local                        |
| `supabase/migrations/20260721120000_wal_chat_core.sql`            | Schema integral, RLS, views, triggers e GRANTs       |
| `supabase/migrations/20260721180000_integrations_meta_openai.sql` | OAuth, secrets cifrados, IA e RBAC                   |
| `supabase/seed.sql`                                               | Tenant, conta Instagram e automações de demonstração |

## Implantação

| Arquivo                           | Responsabilidade                                      |
| --------------------------------- | ----------------------------------------------------- |
| `deploy/prepare-supabase.sh`      | Materializa instância isolada e troca portas/domínios |
| `deploy/render-production-env.sh` | Gera secrets e `.env.production` com permissão 600    |
| `deploy/nginx/wal-chat.conf`      | Proxy reverso da aplicação e Supabase API             |

## Assets públicos

| Arquivo                                    | Responsabilidade                 |
| ------------------------------------------ | -------------------------------- |
| `public/manifest.json`                     | Metadados PWA e cores da marca   |
| `public/og.png`                            | Card Open Graph Wal Chat         |
| `public/favicon.ico`                       | Ícone do navegador               |
| `public/logo192.png`, `public/logo512.png` | Ícones instaláveis               |
| `public/robots.txt`                        | Instruções básicas para crawlers |

## Documentação e evidências

| Arquivo                                           | Responsabilidade                   |
| ------------------------------------------------- | ---------------------------------- |
| `README.md`                                       | Porta de entrada do projeto        |
| `docs/ARQUITETURA.md`                             | Componentes e fluxos               |
| `docs/API_E_WEBHOOKS.md`                          | Contratos HTTP                     |
| `docs/BANCO_DE_DADOS.md`                          | Modelo de dados e acesso           |
| `docs/SEGURANCA_E_COMPLIANCE.md`                  | Controles e checklist Live Mode    |
| `docs/CONFIGURACAO_META_E_OPENAI.md`              | Onboarding real e matriz de testes |
| `docs/GUIA_DE_DESENVOLVIMENTO.md`                 | Convenções e Definition of Done    |
| `docs/MANUAL_INTERNO_IMPLEMENTACAO_E_OPERACAO.md` | Runbook completo                   |
| `docs/RELATORIO_VALIDACAO_HOMOLOGACAO.md`         | Resultado da homologação           |
| `output/pdf/manual-interno-wal-chat.pdf`          | Versão distribuível do manual      |
