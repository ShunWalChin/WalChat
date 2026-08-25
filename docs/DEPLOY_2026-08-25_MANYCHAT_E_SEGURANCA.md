# Deploy 25/08/2026 — paridade ManyChat e hardening

Release: `20260825-manychat-parity-v1`
Release anterior (rollback): `20260824-n8n-workflows-v2`

## O que subiu

Duas linhas de trabalho no mesmo release:

- **Segurança:** identidade de rate limit endurecida, cota nos caminhos anônimos,
  cota no gateway Supabase, faixas SSRF, CSP com nonce e seletor de workspace.
- **Paridade ManyChat:** botões nos dois canais, espera por resposta, nó de
  pergunta com validação, requisição externa com mapeamento, simulador de fluxo
  e biblioteca de jornadas prontas.

## Como o deploy funciona neste servidor

Não é um clone Git. Cada release é um diretório em `/opt/wal-chat/releases/` e o
Compose roda de dentro dele. O `.env.production` não é versionado e é copiado do
release anterior — foi por isso que o `git status` local mostrava tarballs:
`walchat-*.tar` eram pacotes de deploy, não artefatos de build.

## Sequência executada

1. **Backup antes de qualquer escrita.**
   `pg_dump --format=custom` completo em
   `/opt/wal-chat/backups/pre-manychat-20260825-223014/postgres.dump` (763 KB),
   mais a imagem anterior marcada como `wal-chat-app:pre-manychat`.
2. **Pacote por `git archive` do HEAD**, com conferência de SHA-256 nas duas
   pontas antes de descompactar.
3. **Ensaio da migration dentro de uma transação com `rollback`.** Aplicar direto
   num banco em modo live sem ensaiar seria apostar; o ensaio mostrou as quatro
   colunas e os dois índices sendo criados e desfeitos sem erro.
4. **Migration aplicada com `--single-transaction`** e registrada em
   `supabase_migrations.schema_migrations` como `20260825120000`.
5. **Build da imagem** dentro do release novo.
6. **Troca da stack** e espera pelos healthchecks.
7. **Nginx**: o diff contra a config viva era exatamente o versionado, nada mais
   havia divergido. Substituído com backup datado, `nginx -t` antes do reload e
   reversão automática caso a sintaxe falhasse.

## Verificação em produção

| Checagem             | Resultado                                      |
| -------------------- | ---------------------------------------------- |
| `/api/ready`         | `ok`, `mode: live`, Supabase 9 ms, Redis 10 ms |
| Containers           | app, redis, scheduler e webhooks `healthy`     |
| CSP                  | `unsafe-inline` ausente de `script-src`        |
| Nonce                | 4 de 4 scripts com o nonce do header           |
| Colunas de espera    | `awaiting_kind/node_id/until/attempts` criadas |
| Constraint de status | aceita `waiting_reply`                         |
| Logs desde a subida  | sem erro, exceção ou falha de import           |

### Bypass de rate limit fechado, medido no domínio real

40 requisições a `/api/data-deletion`, cada uma com um `CF-Connecting-IP` e um
`X-Forwarded-For` diferentes — exatamente a tática do bypass:

| Comportamento | Resultado                                        |
| ------------- | ------------------------------------------------ |
| Antes         | 40 baldes distintos; a cota nunca seria atingida |
| Depois        | 1 balde; `429` a partir da 32ª requisição        |

## Rollback

```bash
cd /opt/wal-chat/releases/20260824-n8n-workflows-v2
docker tag wal-chat-app:pre-manychat wal-chat-app:latest
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

A migration é aditiva — colunas novas, índices novos e um valor a mais no check
de status. Voltar a imagem anterior não exige desfazê-la: o código antigo
simplesmente não usa as colunas. Se ainda assim for preciso reverter o schema, o
dump completo está no diretório de backup acima.

## Pendências

- **Push do CI para o GitHub.** O token OAuth ativo não tem escopo `workflow`,
  então `.github/workflows/ci.yml` é recusado no push. Resolve com
  `gh auth refresh -s workflow` e um novo push.
- **Rotação das credenciais** que estiveram no histórico público — chave SSH,
  usuário administrativo e senhas `owner`/`admin`.
- **Validação com dois workspaces reais** do seletor de tenant.
- **Nenhum fluxo com botões foi exercitado contra a API da Meta ainda.** O
  caminho está implantado e o schema aceita, mas a primeira conversa real com
  botão ainda não aconteceu.
