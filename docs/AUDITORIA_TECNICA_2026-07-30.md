# Auditoria técnica — 30/07/2026

## Parecer

O Wal Chat está apto a continuar como homologação demonstrativa, mas está em **no-go para efeitos externos e contas reais**. A base de autenticação, RLS, webhook, Inbox, compliance, Meta OAuth e IA existe; os bloqueios restantes são principalmente confiabilidade de entrega, infraestrutura de produção, credenciais externas e módulos ainda demonstrativos.

## Escopo lido

- Rotas públicas, privadas e telas TanStack Start.
- Autenticação, autorização por workspace e RLS/GRANTs.
- Webhook HMAC, normalização, deduplicação, BullMQ, worker e scheduler.
- Compliance de 24 horas, HUMAN_AGENT, opt-out, cooldown, blocklist e Private Reply.
- OAuth/token Meta, sender Graph API e provedores de IA.
- Migrations, Compose, Dockerfile, Nginx, scripts de deploy, smokes e documentação.
- Estado da homologação por inspeção somente leitura.

## Achados

### P0 — scheduler da homologação sem banco

O scheduler ativo registra falhas contínuas ao tentar alcançar o Supabase por `host.docker.internal:54351`. O gateway da Supabase CLI está preso ao loopback do host e não é alcançável desse modo pelo container.

Correção preparada localmente:

- backend usa a origem HTTPS do Supabase no ambiente renderizado;
- `/api/ready` reprova Supabase/Redis configurados e indisponíveis;
- o healthcheck da aplicação usa readiness;
- scheduler e worker expõem heartbeat real.

Estado: **não implantado**.

### P0 — homologação não é produção real

O ambiente público permanece em `DEMO_MODE=true` e não possui toda a configuração externa de Meta, IA e SMTP. Isso é correto para segurança, mas impede declarar mensageria, publicação, insights e IA reais como operacionais.

Estado: depende das contas e dos gates documentados em `CONFIGURACAO_META_E_OPENAI.md`.

### P1 — idempotência de DMs externas

Resolvido no código desta branch: DMs manuais e do scheduler recebem chave idempotente, fingerprint e claim persistente antes da chamada à Meta. Resultados `sent/blocked` podem ser reproduzidos; `claimed/unknown` bloqueiam retry automático. Private Reply preserva a trava por comentário.

Estado restante: aplicar a migration com backup, ensaiar o timeout numa conta piloto e criar a fila operacional para reconciliação humana de estados `unknown`.

### P1 — outbox sem reconciliador

Resolvido no código desta branch: o hardening falha com `503` em live quando Redis não está disponível, e o worker reconcilia eventos `queued` contra o `jobId` canônico do BullMQ. Jobs concluídos/falhos atualizam o Postgres; itens sem job são reenfileirados.

Estado restante: métrica/alerta de idade do outbox e operação da fila de falhas.

### P1 — operação e segurança de produção

- Supabase CLI deve ser substituído por projeto gerenciado ou self-host oficial.
- Backups e restore ainda precisam de ensaio.
- SMTP transacional, rate limiting distribuído para escala horizontal, alertas e retenção de logs não estão fechados.
- Credenciais já expostas em terminal operacional precisam ser rotacionadas antes do go-live.
- A exclusão de dados devolve protocolo, mas a eliminação assíncrona definitiva ainda não está ligada.

### P1 — módulos com dados demonstrativos

Dashboard, contatos, sequências, calendário, publicação, auto-like e insights possuem partes visuais apoiadas por fixtures. Cada módulo precisa de contrato backend, persistência, Graph API, testes e telemetria próprios antes de ser marcado como funcional em produção.

### P2 — resiliência de fornecedores

As chamadas Meta usam timeout de 15 segundos e erro sanitizado. Os provedores de IA usam timeout de 45 segundos e no máximo um retry do SDK. DMs não recebem retry automático após claim ambíguo. Circuit breaker, budget por tenant e rate limit distribuído permanecem como evolução operacional.

### P2 — política de conteúdo do navegador

A CSP atual bloqueia fontes e conexões não autorizadas, mas ainda aceita scripts e estilos inline por compatibilidade com SSR/hidratação. A evolução recomendada é nonce por request, validada no navegador antes de remover `unsafe-inline`.

## Mudanças desta branch

- liveness e readiness separados;
- probes reais de Supabase/Redis com resposta sanitizada;
- heartbeats e healthchecks dos workers;
- webhook fail-closed em live sem Redis;
- encerramento seguro das conexões de fila;
- timeout e sanitização no sender Meta;
- claim persistente de DMs e bloqueio de replay ambíguo;
- reconciliador Postgres/BullMQ e persistência de falha;
- timeout uniforme Meta e IA;
- rate limiting versionado no Nginx;
- cabeçalhos HTTP de segurança e `server_tokens off`;
- imagem de runtime sem dependências de desenvolvimento;
- ESLint 10 e auditoria npm sem vulnerabilidades conhecidas;
- workflow CI e Dependabot;
- plano de produção e documentação operacional atualizados.

## Evidência local

- Prettier: aprovado.
- TypeScript: aprovado.
- ESLint: aprovado.
- Vitest: 14 arquivos e 39 testes aprovados.
- Build cliente e SSR: aprovado.
- Auditoria npm completa e de produção: zero vulnerabilidades conhecidas.
- Imagem Linux: construída e executada no Docker do WSL.
- Rotas: 16 páginas com HTTP 200.
- Container: liveness/readiness e cabeçalhos de segurança aprovados.
- Nginx: sintaxe aprovada em `nginx:1.27-alpine`; limite sensível retornou `429`, JSON sanitizado e `Retry-After: 60`.
- Migration de entregas: criada e revisada, mas não aplicada nesta validação; exige backup e aprovação específica no ambiente escolhido.

## Decisão de promoção

- Deploy deste hardening em `DEMO_MODE=true`: tecnicamente recomendado após aprovação explícita, com backup e rollback preservados.
- Ativar `DEMO_MODE=false`: não aprovado até aplicar a migration, validar a infraestrutura final e executar o piloto controlado.
- Conectar uma conta Instagram piloto: aprovação condicional após deploy seguro em `DEMO_MODE=true`, rotação de credenciais e gates descritos em `VALIDACAO_PRODUCAO_REAL_V1.md`.
