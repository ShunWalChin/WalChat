# Registro da release CRM e governança de IA — 28/08/2026

## Objetivo

Publicar a integração das capacidades inspiradas no Deskcomm dentro da
arquitetura nativa do Wal Chat, sem incorporar runtime, banco ou identidade
paralelos.

## Release

- Release promovida: `/opt/wal-chat/releases/20260828-deskcomm-integration-v1`
- Migration: `20260828090000_deskcomm_capabilities_core`
- Pacote SHA-256:
  `05f30f8ef96ea9e1a810934a0a8968393b464f853061b69071cbb6eda8185dae`
- Imagem anterior preservada:
  `wal-chat-app:rollback-20260827-ai-key-save-v1`
- ID da imagem anterior:
  `sha256:5e966f427e9474ee7b67ca93d364eab9600c7d10e3fec591964bf7ad66bc94a1`

A release foi posteriormente sucedida pela `20260831-ux-v1`. A migration e os
módulos permanecem ativos nessa versão.

## Backup pré-deploy

- Arquivo: `/var/backups/wal-chat/20260828T152757-pre-live.tar.gz`
- Tamanho: `522341215` bytes
- SHA-256:
  `a74562d632e06330d296a762965330eba7ded8dd1c7645ba1cf7e48084179a04`
- Verificação: hash, gzip/tar, manifesto, dumps, volumes, releases, Nginx/TLS,
  inventário e imagens aprovados.

## Conteúdo entregue

- Pipeline CRM Kanban e API de oportunidade.
- Radar de risco e reconciliação no scheduler.
- Disponibilidade, capacidade e roteamento automático de equipe.
- Respostas rápidas integradas à Inbox.
- Governança de IA: budget, versões, routers, memória, casos e telemetria.
- Webhooks de captação de lead com token hash-only.
- Auditoria administrativa.
- Salvamento funcional de provedor/modelo/chave de IA com validação no
  provedor, cifra e preservação da chave existente.
- 21 tabelas novas com RLS, índices, constraints, triggers e grants.

## Procedimento executado

1. Inspeção da release, containers, disco e migration history.
2. Backup completo e verificação de integridade.
3. Empacotamento do worktree sem `.env`, caches, builds ou dependências.
4. Verificação do checksum no servidor.
5. Tag da imagem de rollback.
6. Ensaio integral da migration em `BEGIN/ROLLBACK`.
7. Aplicação em transação única e registro no histórico Supabase.
8. Build Docker; `npm ci` e `npm prune` sem vulnerabilidades conhecidas.
9. Promoção de app, worker e scheduler.
10. Validação de readiness, rotas, auth guards, banco e logs.

## Evidências

- Build cliente: 3.362 módulos transformados.
- Build SSR: 238 módulos transformados.
- `28` rotas SSR retornaram HTTP 200.
- 404, robots, sitemap e health aprovados.
- APIs novas recusaram acesso sem sessão com HTTP 401.
- App, Redis, webhook worker e scheduler ficaram saudáveis.
- Readiness público e interno retornaram HTTP 200 em modo `live`.
- Release ativa confirmada pelo label
  `com.docker.compose.project.working_dir`.
- Antes da publicação local: 45 arquivos de teste e 281 testes aprovados,
  TypeScript, ESLint, Prettier, auditoria do sistema e build aprovados.

## Rollback

O rollback da aplicação reutiliza a release
`20260827-ai-key-save-v1` e a imagem `rollback-20260827-ai-key-save-v1`. A
restauração do banco usa exclusivamente o backup validado acima e o runbook
[Ativação live e backup](ATIVACAO_LIVE_E_BACKUP_2026-08-24.md).
