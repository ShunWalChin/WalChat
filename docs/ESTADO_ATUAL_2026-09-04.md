# Estado atual do Wal Chat — 04/09/2026

Este registro separa o release candidate local da versão pública. Ele não
contém tokens, senhas, payloads de clientes nem conteúdo de mensagens.

## Resumo executivo

O release candidate executa as dez frentes do roadmap: corrige persistência do
scheduler, torna o E2E autenticado determinístico, amplia o CRM para paginação e
operações em massa, move comandos compostos para transações, preserva contexto
de trabalho, estabelece budgets de bundle, adiciona SLOs/alertas e prepara o
transporte de IA pelo OmniRoute.

| Dimensão              | Estado do release candidate        | Evidência                                                                               |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| Testes                | aprovado                           | 62 arquivos e 424 testes                                                                |
| Usabilidade           | aprovado                           | 25 telas × 3 viewports; 75/75 cenários                                                  |
| CRM crítico           | aprovado em fixture E2E            | criar e mover lead sem loading residual                                                 |
| Teclado móvel         | aprovado                           | abre, foca fechar, fecha com Escape e devolve foco                                      |
| Escritas verificadas  | aprovado                           | auditoria no teto histórico de 56, sem regressão                                        |
| Bundle                | aprovado                           | CRM 99.383 B; entrada 253.443 B; CSS 182.809 B                                          |
| Tipos, lint e formato | aprovado                           | TypeScript, ESLint e Prettier sem erro                                                  |
| Banco local           | pendente de runtime                | Docker local não estava disponível; CI aplica as migrations duas vezes em PostgreSQL 16 |
| Git                   | reconciliado                       | branch de release reaplicada sobre `github/main`, sem conflito pendente                 |
| Produção              | ainda na release anterior          | promoção somente depois de backup e CI verde                                            |
| OmniRoute             | código pronto; credencial pendente | login local rejeitou a senha padrão; nenhuma tentativa adicional foi feita              |

## Funções do sistema

### Atendimento e canais

- Inbox unificada de Instagram e WhatsApp, prioridade, responsável, notas,
  janela de atendimento e resposta manual/assistida.
- Webhooks assinados, ingestão idempotente, processamento em worker, replay e
  reconciliação de comentários perdidos.
- Comment-to-DM, gatilhos, boas-vindas, reengajamento e envio protegido por
  compliance, cooldown e kill switches.

### CRM comercial

- Múltiplos pipelines e etapas ordenáveis.
- Quadro Kanban e lista, busca e filtros representados na URL, paginação no
  servidor e ordenação operacional.
- Criar, editar e mover leads; score, risco, valor, probabilidade, responsável,
  próxima ação, tags, motivo de perda e campos personalizados.
- Seleção e atualização em massa, importação/exportação CSV e anexos em bucket
  privado com URL assinada de curta duração.
- Drawer 360º com notas, tarefas, reuniões, ligações, e-mails, links e histórico.
- Rascunho em `sessionStorage`, bloqueio de saída, atalho `/` ou `Ctrl+K` para
  busca e desfazer após movimentação.
- Comandos compostos de lead, atividade, pipeline, reordenação, lote e
  importação executados por RPC transacional.

### Automação, IA e crescimento

- Automation Studio com DAG versionado, simulação, condições, espera, A/B,
  ações CRM, handoff, HTTP e eventos n8n.
- Agentes copiloto/autônomo, conhecimento, orçamento, auditoria e telemetria.
- OpenAI Responses API, Gemini e gateway OmniRoute compatível com `/v1`.
- Captação, páginas de agenda, Google Calendar/Tasks/Meet, conteúdo, Insights e
  rastreamento Google Ads OCI/Meta CAPI.

### Operação e segurança

- Multi-tenant por workspace, JWT, RLS e credenciais cifradas no servidor.
- Central de Go-Live, readiness, liveness, heartbeat de workers, replay de
  webhooks, logs estruturados com `x-request-id` e latência.
- SLOs de 24 horas para scheduler, webhooks, IA e conversões; alertas externos
  opcionais, deduplicados e sem PII.
- Backup completo do host para produção e backup local cifrado/restaurável do
  código e histórico Git.

## OmniRoute

O Wal Chat mantém `provider=openai` no contrato do workspace e troca apenas o
transporte server-side quando `OMNIROUTE_BASE_URL` está configurada. Isso evita
uma migration só para o nome do gateway e preserva toda a governança existente.

Ambiente local executando o app diretamente:

```dotenv
OMNIROUTE_BASE_URL=http://127.0.0.1:20128/v1
OMNIROUTE_API_KEY=<chave emitida pelo OmniRoute>
OPENAI_MODEL=<rota-ou-modelo-disponível>
```

App dentro do Docker Desktop e OmniRoute no host:

```dotenv
OMNIROUTE_BASE_URL=http://host.docker.internal:20128/v1
```

A chave também pode ser salva por workspace em **Configurações > Provedor de
IA**. Projeto e organização OpenAI não são enviados ao gateway. A ativação deve
ocorrer somente com uma credencial real e o teste do botão **Salvar e testar**.

## SLOs e alertas

A tela **Operações** consulta `/api/operations/slo`, reservado a `owner/admin`.
Os limiares padrão são:

- falha: cinco falhas, fila de 50 itens ou item pendente há 30 minutos;
- atenção: ao menos uma falha, fila de dez itens ou espera de dez minutos;
- repetição do alerta: no máximo uma vez a cada 30 minutos enquanto o mesmo
  incidente permanecer aberto;
- recuperação: uma notificação é emitida quando o estado volta a `pass`.

Para alertas externos, configure `OPERATIONS_ALERT_WEBHOOK_URL`. O corpo contém
somente ID do workspace, severidade e métricas agregadas.

## Backup e restauração

Com o worktree limpo, execute no PowerShell:

```powershell
./scripts/ops/create-local-release-backup.ps1
```

O pacote em `backups/` contém snapshot do commit e todo o histórico Git, ambos
cifrados por AES-256-GCM. A chave é protegida pelo DPAPI da conta Windows atual.
O script calcula SHA-256 e executa um ensaio de leitura do tar e do bundle.

Para verificar novamente:

```powershell
./scripts/ops/restore-local-release-backup.ps1 -BackupPath '<pasta>' -VerifyOnly
```

Para restaurar o código em uma pasta nova:

```powershell
./scripts/ops/restore-local-release-backup.ps1 -BackupPath '<pasta>' -Destination '<pasta-nova>'
```

O snapshot de código não inclui `.env.*`. Antes de migration em produção, use
também `scripts/ops/create-complete-backup.sh`, que cobre Postgres, Redis,
Storage, releases, imagens e configuração da borda.

## Acessos

- aplicação pública: <https://wal-chat.64.181.178.125.nip.io/>
- pipeline: <https://wal-chat.64.181.178.125.nip.io/crm>
- operações: <https://wal-chat.64.181.178.125.nip.io/operacoes>
- configurações de IA: <https://wal-chat.64.181.178.125.nip.io/configuracoes>
- saúde: <https://wal-chat.64.181.178.125.nip.io/api/health>
- prontidão: <https://wal-chat.64.181.178.125.nip.io/api/ready>
- repositório: <https://github.com/ShunWalChin/WalChat>

O inventário de todas as telas e callbacks está no
[manual completo](MANUAL_COMPLETO_ACESSOS_OPERACAO_CONFIGURACAO.md).
