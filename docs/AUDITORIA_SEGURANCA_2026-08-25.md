# Auditoria de segurança — 25/08/2026

Escopo: código versionado (`src`, `scripts`, `supabase`, `deploy`), superfície
HTTP publicada em `https://wal-chat.64.181.178.125.nip.io`, exposição do
repositório público `ShunWalChin/WalChat` e o portão de qualidade do projeto.

## Estado encontrado

O backend chega nesta auditoria em bom estado. Os controles abaixo já existiam e
foram confirmados linha a linha, não apenas pela documentação:

- **RLS em 56 de 56 tabelas** de negócio; nenhuma policy usa `using (true)`.
- **23 de 23 funções `security definer`** fixam `set search_path` — nenhuma fica
  exposta a sequestro de esquema.
- **HMAC constante** (`timingSafeEqual`) nos webhooks Meta, com o corpo lido em
  bruto antes de qualquer `JSON.parse`.
- **AES-256-GCM com AAD por tenant** nas credenciais: um ciphertext não pode ser
  movido entre workspaces, providers ou contas nem por quem tem acesso ao banco.
- **OAuth Meta e Google** com state de uso único, cookie `__Host-`, PKCE no
  Google e comparação em tempo constante.
- **SSRF do n8n** bloqueada por resolução DNS prévia e recusa de faixas privadas.
- **Contêiner de produção** `read_only`, `cap_drop: ALL`, `no-new-privileges`,
  usuário não-root, limites de memória, CPU e PIDs.
- **Cabeçalhos de segurança** completos, incluindo HSTS, CSP, COOP/CORP e
  `frame-ancestors 'none'`.
- **Zero segredos versionados** e `npm audit --omit=dev` sem vulnerabilidades.

## Correções aplicadas nesta auditoria

### 1. Bypass do rate limit por header de IP forjado — corrigido

`requestIdentity()` lia `cf-connecting-ip` como primeira opção e, na sequência,
o **primeiro** elemento de `x-forwarded-for`. Nenhum dos dois é escrito pelo
Nginx desta implantação:

- não há CDN no caminho, então `CF-Connecting-IP` chegava exatamente como o
  cliente digitou;
- `$proxy_add_x_forwarded_for` **acrescenta** o peer real ao fim da cadeia, logo
  o primeiro elemento também é texto do cliente.

Consequência: bastava variar um header por requisição para ganhar um balde de
rate limit novo a cada chamada. Os dois endpoints anônimos de escrita —
`POST /api/public/bookings/:slug` e `POST /api/privacy/deletion-requests` —
ficavam sem cota efetiva.

A correção reescreve o resolvedor para aceitar apenas `x-real-ip` (definido pelo
proxy), com o **último** salto de `x-forwarded-for` como âncora secundária, e
valida que o resultado é um IP de verdade. Deployments atrás de CDN declaram o
header explicitamente em `TRUSTED_CLIENT_IP_HEADER`. Em paralelo o Nginx passou
a limpar `CF-Connecting-IP`, `True-Client-IP`, `X-Client-IP` e
`Fastly-Client-IP` em todas as locations.

Prova empírica contra o bundle de produção, 100 requisições com um
`CF-Connecting-IP` diferente em cada uma:

| Comportamento | Resultado                                     |
| ------------- | --------------------------------------------- |
| Antes         | 100 baldes distintos, cota nunca atingida     |
| Depois        | 1 balde, `429` a partir da requisição da cota |

### 2. `/api/data-deletion` sem `X-Real-IP` no Nginx — corrigido

A location `= /api/data-deletion` não repassava `X-Real-IP` nem
`X-Forwarded-For`, então a identidade daquele endpoint era 100% escolhida pelo
cliente mesmo depois da correção da aplicação. Ambos os headers foram
adicionados.

### 3. Endpoints anônimos sem cota na aplicação — corrigido

Quatro caminhos anônimos tocavam Postgres com service role sem nenhum limite na
camada da aplicação:

| Endpoint                                | Cota aplicada |
| --------------------------------------- | ------------- |
| `GET /api/data-deletion`                | 30 / 5 min    |
| `POST /api/data-deletion`               | 20 / 5 min    |
| `GET /api/public/reviews`               | 60 / 1 min    |
| `GET /api/integrations/meta/callback`   | 30 / 5 min    |
| `GET /api/integrations/google/callback` | 30 / 5 min    |

Os webhooks Meta receberam um tratamento diferente e proposital: **burst
assinado da Meta continua sem cota**. Só quem falha a verificação HMAC entra no
balde (20 / 5 min), de modo que uma enxurrada forjada para de consumir CPU sem
que tráfego legítimo seja afetado.

### 4. Gateway Supabase exposto sem cota — corrigido

O host `api-wal-chat.…` publica `/auth/v1` na internet e não tinha nenhum
`limit_req`. Login, cadastro e recuperação de senha estavam abertos a credential
stuffing na borda. Foram criadas duas zonas: `wal_supabase` (30 r/s geral) e
`wal_supabase_auth` (12 r/min nos caminhos de autenticação).

### 5. Faixas reservadas ausentes no filtro SSRF — corrigido

`isPublicAddress()` não bloqueava `192.0.0.0/24`, `192.0.2.0/24`,
`198.51.100.0/24` e `203.0.113.0/24`. A fixture do próprio teste usava
`203.0.113.20` como endereço "público" — ela passava justamente porque a faixa
não era filtrada. A fixture foi trocada por um IP público real e as quatro
faixas ganharam cobertura de teste.

### 6. Divulgação de infraestrutura no repositório público — corrigido no HEAD

`ShunWalChin/WalChat` é **público**. O manual de acessos entregava, em texto
claro, o usuário SSH administrativo, o usuário de recuperação, o caminho da
chave privada na máquina do operador e os e-mails das contas `owner`/`admin` do
aplicativo. Somados ao IP — que o próprio domínio `nip.io` já revela — isso é um
alvo de login pronto.

Os identificadores viraram marcadores `<ASSIM>` apontando para o cofre
`Acessos Privados/`, e o documento passou a avisar que o repositório é público.

> **Pendência que exige ação humana:** a correção vale do HEAD em diante. Os
> valores continuam no histórico Git já publicado (a partir de `efa634d` e
> `9151e1b`). Redigir o arquivo não desfaz isso — ver "Ações pendentes".

### 7. Portão de qualidade sem automação — corrigido

O repositório tinha 120 testes, lint, typecheck e auditoria estática, e **nenhum
CI executando nada disso**. Foi criado `.github/workflows/ci.yml` com três jobs:
verificação completa (formato, lint, tipos, testes, auditoria estática, build e
`validate:routes` contra o servidor de produção real subido em modo demo),
`npm audit --omit=dev --audit-level=high` e varredura de segredos com gitleaks.
`permissions: contents: read` em todos os jobs.

### 8. Invariantes fixadas no `audit:system`

Para que as regressões não voltem em silêncio, `scripts/audit-system.mjs` passou
a falhar quando:

- uma rota anônima não chama `assertRateLimit`;
- uma rota lê header de IP do cliente diretamente em vez de usar o resolvedor
  endurecido.

Foi essa checagem nova que encontrou os dois callbacks OAuth sem cota.

### 9. Snapshots de deploy fora do `.gitignore`

Quatro arquivos `walchat-*.tar` (~20 MB) estavam na árvore de trabalho sem
serem ignorados — a um `git add -A` de entrar no repositório público. `*.tar`,
`*.tar.gz` e `*.tgz` foram adicionados ao `.gitignore`.

## Verificação

| Etapa                     | Resultado                                    |
| ------------------------- | -------------------------------------------- |
| `npm test`                | 120 testes, 30 arquivos, 0 falhas            |
| `npx tsc --noEmit`        | limpo                                        |
| `npm run lint`            | limpo                                        |
| `npm run check`           | limpo                                        |
| `npm run audit:system`    | `ok: true`, 0 findings                       |
| `npm run build`           | cliente e SSR gerados                        |
| `npm run validate:routes` | 21 rotas HTML, 404, robots, sitemap e health |
| `npm audit --omit=dev`    | 0 vulnerabilidades                           |

Antes desta auditoria a suíte tinha 105 testes; os 15 novos cobrem o resolvedor
de identidade e as faixas SSRF recém-bloqueadas.

## Ações pendentes que exigem decisão humana

1. **Rotacionar o que já vazou.** Trocar a chave SSH da Oracle Cloud, avaliar a
   renomeação do usuário administrativo e trocar as senhas das contas
   `owner`/`admin` do aplicativo. O histórico público não pode ser desfeito
   apenas editando o arquivo; reescrever o histórico exige `force push` e
   invalida clones existentes.
2. **Recarregar o Nginx do servidor.** As mudanças em
   `deploy/nginx/wal-chat.conf` estão no repositório, não na máquina. Rodar
   `sudo nginx -t && sudo systemctl reload nginx` após copiar o arquivo.
3. **Publicar o branch de trabalho.** `github/main` está 41 commits atrás de
   `codex/backend-core-hardening`. Quem seguir o `gh repo clone` do próprio
   README hoje recebe a versão de 21/07, sem nenhum hardening desta linha.
4. **Domínio próprio no lugar do `nip.io`.** Enquanto o host codificar o IP, não
   há como não divulgar o endereço do servidor.
5. **CSP sem `unsafe-inline` em `script-src`.** Hoje a diretiva permite script
   inline, o que reduz muito o valor da CSP contra XSS — e a sessão Supabase
   fica em `localStorage`. Migrar para CSP com nonce.
6. **Rebinding DNS na saída para o n8n.** A resolução acontece na validação e
   não no momento do `fetch`; fechar a janela exige fixar o IP resolvido no
   agente HTTP.
