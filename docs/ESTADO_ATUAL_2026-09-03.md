# Estado atual do Wal Chat — 03/09/2026

Esta avaliação separa o que está realmente publicado do que existe apenas na
base local. Nenhuma credencial, token ou endereço privado foi registrado.

## Resumo executivo

| Dimensão                   | Estado                  | Evidência                                                         |
| -------------------------- | ----------------------- | ----------------------------------------------------------------- |
| Disponibilidade pública    | Aprovada                | aplicação, liveness e readiness responderam `200`                 |
| Runtime                    | Aprovado                | modo `live`; Supabase e Redis `up`                                |
| Contêineres                | Aprovado                | app, Redis, scheduler e webhooks saudáveis há três dias           |
| Release publicada          | Identificada            | `/opt/wal-chat/releases/20260831-ux-v1`                           |
| IA OpenAI                  | Configurada             | credencial cifrada de workspace detectada pelo readiness          |
| Botão de salvar IA         | Publicado               | chunk de Configurações contém `Salvar configurações`              |
| n8n                        | Disponível              | painel e `/healthz` responderam `200`                             |
| OCI/CAPI                   | Somente local           | endpoint de status retorna `404` em produção                      |
| Usabilidade                | Boa; automação pendente | revisão manual aprovada; matriz integral depende de serviços      |
| Testes                     | Aprovados               | 58 arquivos e 402 testes                                          |
| Tipos, lint e build        | Aprovados               | TypeScript, ESLint e build cliente/SSR sem erro                   |
| Dependências de produção   | Aprovadas               | `npm audit --omit=dev`: zero vulnerabilidades conhecidas          |
| Portão estático do sistema | Reprovado               | 66 escritas sem verificação; teto permitido 56                    |
| Git                        | Requer reconciliação    | branch local: 29 commits exclusivos; `github/main`: 25 exclusivos |
| Backup                     | Íntegro, porém anterior | snapshot de 02/09 com três hashes SHA-256 aprovados               |

## Produção verificada

- URL: <https://wal-chat.64.181.178.125.nip.io/>.
- Release ativa: `/opt/wal-chat/releases/20260831-ux-v1`.
- Aplicação, Redis, scheduler e worker de webhooks: `healthy`.
- Disco raiz: 47% utilizado.
- Supabase e Redis: `up` no readiness.
- Meta, Instagram, WhatsApp, criptografia de credenciais, OpenAI e Google
  Workspace: capacidades detectadas.
- Gemini: não configurado.
- Os 26 endereços de página inventariados responderam `200`; Contatos e
  Calendário primeiro normalizam filtros na URL por redirecionamento `307`.

O liveness informa `openai: false` porque só observa `OPENAI_API_KEY` no
ambiente. O readiness informa `openaiConfigured: true` porque também consulta a
credencial cifrada por workspace. Este é o comportamento esperado do código.

## O que ainda não está em produção

### Google Ads OCI e Meta CAPI

As rotas, tela, fila, regras de CRM, consentimento e documentação existem na
base local. A sonda anônima de
`/api/integrations/conversions/status` retornou `404`; se a rota estivesse
publicada, retornaria `401` sem sessão. Portanto, a atualização ainda não faz
parte da release ativa.

### Refino de usabilidade

As melhorias locais incluem navegação móvel com foco e Escape, alvos mínimos de
44 px, skip link, estados de salvamento/erro, responsividade e orientação das
ações principais. A revisão manual do CRM foi aprovada em desktop e mobile. A
matriz automatizada prevê 25 telas em `375x812`, `812x375` e `1440x900`, mas a
reexecução integral ainda não é determinística quando Supabase ou Redis estão
indisponíveis; uma tela aguardando serviço não deve valer como sucesso
funcional. Essas mudanças ainda estão sem commit no worktree.

### CRM 2.0

O CRM local permite criar, editar, mover e reordenar leads; alternar board e
lista; pesquisar e filtrar; administrar pipelines e etapas; registrar
atividades; e associar assets por URL. A API ainda carrega até 500 leads e a
tela consulta até 100 contatos, portanto paginação no servidor, virtualização,
operações em massa e upload para storage permanecem como próximos passos antes
de escalar a carteira.

## Qualidade da base local

Comandos executados em 03/09/2026:

```text
npm test                 58 arquivos / 402 testes aprovados
npx tsc --noEmit         aprovado
npm run lint             aprovado
npm run build            cliente e SSR aprovados
npm audit --omit=dev     0 vulnerabilidades conhecidas
npm run audit:system     reprovado: 66 escritas sem verificação > teto 56
```

O portão estático não encontrou consultas sem escopo de workspace, módulos com
dados de demonstração nem lacunas de produção. A única reprovação é o aumento de
10 escritas sem checagem explícita de erro, todas identificadas no scheduler.
O CI ainda não possui suíte E2E autenticada; seus 54 arquivos de teste em `src`
se concentram em `server` e `lib`.

## Git e backup

- Branch ativa: `fix/conformidade-e-portao-de-schema`.
- Commit base do trabalho: `c3e7e8b` (`feat: implementa rastreamento OCI e Meta CAPI`).
- Divergência contra `github/main`: 29 commits exclusivos locais e 25 commits
  exclusivos no GitHub.
- Há arquivos modificados e arquivos novos ainda não versionados.
- Repositório: <https://github.com/ShunWalChin/WalChat>.
- Backup local mais recente: `backups/local/20260902T091131`.
- Worktree, bundle Git e cópia do ambiente de produção tiveram SHA-256
  recalculado e aprovado.

O backup é restaurável, mas antecede o OCI/CAPI consolidado e o refino de
usabilidade de 03/09. Um novo backup é obrigatório antes da próxima publicação.

## Decisão de deploy

**Não publicar diretamente o worktree atual.** Ordem segura:

1. corrigir as 10 novas escritas sem verificação explícita;
2. reconciliar a branch com `github/main` sem perder alterações;
3. repetir testes, lint, build, auditoria do sistema e usabilidade;
4. criar backup completo pré-release e validar os hashes;
5. publicar uma release imutável;
6. validar autenticação, IA, OCI/CAPI, n8n, Meta, Google e rotas públicas;
7. manter a release anterior disponível para rollback.

Os links operacionais completos estão no
[manual de acessos](MANUAL_COMPLETO_ACESSOS_OPERACAO_CONFIGURACAO.md).
As dez frentes recomendadas, com prioridade e critério de aceite, estão no
[roadmap de melhorias](ROADMAP_10_MELHORIAS_2026-09-03.md).
