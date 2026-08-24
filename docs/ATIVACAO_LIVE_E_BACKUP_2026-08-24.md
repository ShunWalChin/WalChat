# Backup completo e ativação live — 24/08/2026

## Resultado executivo

O Wal Chat foi promovido para a release
`20260824-production-live-v1`. O endpoint público `/api/ready` confirma
`ok=true`, `status=ready` e `mode=live`. App, worker de webhooks, scheduler e
Redis permaneceram saudáveis após a recriação controlada.

O `DEMO_MODE` está desativado. Os controles por workspace continuam com
`external_sends_enabled=false`, `comment_to_dm_enabled=false` e
`autonomous_ai_enabled=false`. Esta combinação permite validar dependências e
APIs reais sem executar mensagem, Private Reply ou IA autônoma antes do canário
autorizado.

## Backup pré-Go-Live

| Item          | Valor                                                              |
| ------------- | ------------------------------------------------------------------ |
| Identificador | `20260824T161200-pre-live`                                         |
| Servidor      | `/var/backups/wal-chat/20260824T161200-pre-live.tar.gz`            |
| Cópia local   | `backups/20260824T161200-pre-live/20260824T161200-pre-live.tar.gz` |
| Tamanho       | `343098050` bytes                                                  |
| SHA-256       | `dc1140585cf3c220365754981da44ad115bfe91c1d49f12f2ad70682b5220dea` |

O hash calculado após o download local é idêntico ao hash do servidor. O
pacote também passou por `gzip --test`, listagem integral do tar e validação de
todos os itens de `MANIFEST.sha256` em uma extração temporária.

O pacote contém:

- dump SQL completo do PostgreSQL;
- dump customizado e catálogo validado pelo `pg_restore`;
- snapshot consistente do Redis;
- volumes de Storage e Edge Runtime do Supabase isolado;
- aplicação, releases, migrations, Compose e arquivos de ambiente;
- Nginx e certificado TLS;
- inventário de contêineres, redes, volumes e imagens;
- imagens Docker próprias do Wal Chat, incluindo rollback;
- roteiro mínimo de restauração.

> O arquivo contém secrets, hashes de autenticação e chave TLS. A pasta local
> está ignorada pelo Git e possui ACL restrita. O pacote não deve ser enviado
> por e-mail, mensageria ou armazenamento público.

## Release e rollback

| Função                   | Caminho                                                 |
| ------------------------ | ------------------------------------------------------- |
| Release ativa            | `/opt/wal-chat/releases/20260824-production-live-v1`    |
| Rollback seguro          | `/opt/wal-chat/releases/20260824-production-modules-v2` |
| Configuração ativa       | `DEMO_MODE=false`                                       |
| Configuração de rollback | `DEMO_MODE=true`                                        |

Rollback operacional:

```bash
rollback=/opt/wal-chat/releases/20260824-production-modules-v2
sudo docker compose \
  --project-directory "$rollback" \
  --project-name wal-chat \
  --env-file "$rollback/.env.production" \
  -f "$rollback/docker-compose.production.yml" \
  up -d --no-build
```

Após o rollback, validar `/api/ready`; o campo `mode` deve voltar para `demo`.

## Pré-flight antes da ativação

- nenhum job pendente ou em processamento;
- nenhuma campanha agendada ou em execução;
- nenhum conteúdo agendado ou em publicação;
- zero webhooks com falha nas 24 horas anteriores;
- zero entregas com resultado `unknown`;
- token Instagram não expirado;
- credencial cifrada por workspace presente;
- scopes e campos de webhook obrigatórios presentes;
- Supabase, Redis, HTTPS e cofre de credenciais disponíveis;
- backup completo verificado e rollback preservado.

## Testes reais executados

### Instagram API

As chamadas foram somente de leitura e executadas com a credencial cifrada que
o runtime live usará:

| Verificação                           | Resultado                         |
| ------------------------------------- | --------------------------------- |
| Perfil próprio e identidade vinculada | HTTP 200 e identidade consistente |
| Leitura de mídia                      | HTTP 200                          |
| Limite de publicação                  | HTTP 200                          |
| Leitura de `subscribed_apps`          | HTTP 200                          |
| Campos obrigatórios assinados         | Aprovado                          |
| Token expirado                        | Não                               |

### HTTPS, filas e webhooks

| Verificação                          | Resultado              |
| ------------------------------------ | ---------------------- |
| `/api/health`                        | Aprovado               |
| `/api/ready` em live                 | Aprovado               |
| Supabase e Redis                     | Ativos                 |
| Challenge Instagram                  | Aprovado               |
| Challenge WhatsApp                   | Aprovado               |
| HMAC inválido Instagram/WhatsApp     | Rejeitado com HTTP 401 |
| HMAC válido com payload vazio        | Aceito com HTTP 200    |
| Evento processado                    | Aprovado               |
| Jobs criados pelo smoke              | Zero                   |
| Entregas externas criadas pelo smoke | Zero                   |

### Gate de saída

O método usado imediatamente antes do I/O externo foi executado dentro do
contêiner live. O resultado foi
`external_sends_disabled`, comprovando que o workspace continua protegido mesmo
com `DEMO_MODE=false`.

## Limitações atuais do canário externo

1. A credencial Instagram ativa continua vinculada à conta legada
   `@walfredonetto`. `_fat.tech` existe no cadastro, mas ainda não possui a
   credencial ativa usada pelo runtime.
2. Não existe WABA/telefone conectado no banco; apenas o backend de Embedded
   Signup está configurado.
3. OpenAI e Gemini não possuem chave configurada.
4. Google Workspace não possui OAuth Client configurado.
5. SMTP de produção ainda não está configurado.

Por esses motivos, nenhum envio representando o usuário foi executado. O
primeiro envio exige definir a conta remetente correta, um destinatário de QA
que consentiu e a mensagem exata do canário.

## Próximo canário

1. Concluir o OAuth de `_fat.tech` e repetir `meta-live-preflight.mjs`.
2. Confirmar no diagnóstico que `_fat.tech` é a única credencial Instagram
   ativa do workspace piloto.
3. Informar um contato de teste que tenha enviado DM nas últimas 24 horas.
4. Ativar somente `external_sends_enabled`.
5. Enviar uma única mensagem com identificador de idempotência e rodapé
   `Responda PARAR`.
6. Confirmar receipt, Inbox, `outbound_deliveries` e auditoria.
7. Repetir a mesma chave e comprovar que não ocorre segundo envio.
8. Somente depois avaliar `comment_to_dm_enabled`; IA autônoma permanece
   desligada até existir provedor configurado.

## Scripts operacionais adicionados

- `scripts/ops/create-complete-backup.sh`
- `scripts/ops/verify-complete-backup.sh`
- `scripts/ops/meta-live-preflight.mjs`
- `scripts/ops/live-safe-smoke.mjs`
- `scripts/ops/verify-live-kill-switch.mjs`

Nenhum desses scripts imprime credenciais ou conteúdo de contatos.
