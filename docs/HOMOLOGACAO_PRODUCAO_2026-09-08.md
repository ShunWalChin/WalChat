# Homologação de produção — 8 de setembro de 2026

## Parecer executivo

**Decisão: NO-GO para ampliar o uso em produção ou promover o candidato local.**

O núcleo atualmente publicado está online e processando tráfego: aplicação,
worker de webhooks, scheduler, Redis, Meta, n8n, CRM e IA direta responderam aos
testes. A liberação de uma nova release fica bloqueada até resolver os itens P0 e
P1 deste relatório. Nenhum teste enviou mensagem a cliente, publicou conteúdo ou
acionou uma conversão de anúncios.

Produção observada:

- aplicação: <https://wal-chat.64.181.178.125.nip.io/>;
- release ativa: `20260831-ux-v1`;
- imagem ativa: criada em `2026-08-31T03:38:35Z`;
- commit local de base: `0c01032639fe25a9ca0b2380e950218a42b4a6a9`;
- modo efetivo do container: `DEMO_MODE=false`;
- envios externos, Comment-to-DM e IA autônoma: ativos no workspace;
- data/hora da auditoria: `2026-09-08T11:05:47-03:00`.

## Bloqueios de liberação

| Prioridade | Bloqueio                                                   | Evidência                                                                                                                           | Saída obrigatória                                                                                    |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P0         | Schema de produção atrasado                                | Última migration aplicada: `20260830180000`; a RPC `workspace_operational_slos` não existe e `/api/operations/slo` retorna HTTP 500 | Backup novo, ensaio e aplicação das migrations pendentes                                             |
| P0         | Imagem ativa possui dependências vulneráveis               | `npm audit --omit=dev` dentro do container encontrou 12 vulnerabilidades altas na cadeia `browserslist`/TanStack de build           | Rebuild a partir do lock local auditado, que retorna zero vulnerabilidades                           |
| P0         | Candidato local não é a release publicada                  | A produção usa a imagem de 31/08; Google UX, OCI/CAPI CTWA e o fallback 404 estão apenas no worktree local                          | Consolidar uma release única, versionada e reproduzível antes do deploy                              |
| P1         | Google Calendar não está conectado                         | Plataforma configurada, `connections: 0`; OAuth retorna `403 access_denied` porque o app `nip.io` não concluiu a verificação        | Publicar/verificar a tela de consentimento do Google ou usar usuário de teste somente em homologação |
| P1         | Endpoint desconhecido de API retorna 500 na produção       | `GET /api/does-not-exist` retornou 500                                                                                              | Publicar o fallback `/api/$` já corrigido e testado localmente                                       |
| P1         | CTWA/OCI-CAPI ainda não existe no banco publicado          | Colunas `ctwa_clid`, `ctwa_source_id` e `ctwa_waba_id`: zero; migration `20260905113000` não aplicada                               | Incluir a migration CTWA na promoção e executar os testes estruturais                                |
| P1         | n8n muito desatualizado e sem headers de borda             | Instância `1.119.1`; versão estável observada em 08/09: `2.37.11`; HSTS, CSP, X-Frame-Options e nosniff ausentes                    | Backup/export, ensaio de upgrade, atualização suportada e headers no Cloudflare/proxy                |
| P1         | OmniRoute não é usado pela produção                        | Container ativo não possui `OMNIROUTE_BASE_URL`/`OMNIROUTE_API_KEY`; serviço local `127.0.0.1:20128` está fora do ar                | Implantar o gateway numa rede alcançável pela produção e testar failover por provedor                |
| P2         | WhatsApp sem conta operacional                             | O app e o webhook estão configurados, mas o status autenticado retornou zero contas WhatsApp conectadas                             | Concluir Embedded Signup com uma conta piloto e validar template/janela sem cliente real             |
| P2         | Backup não é suficientemente recente para o próximo deploy | Backup mais recente: `20260902T121428-pre-live.tar.gz`; checksum aprovado, mas já possui seis dias                                  | Gerar e verificar backup imediatamente antes da migration/release                                    |

## Matriz executada

### Candidato local

| Gate                              | Resultado                                                  |
| --------------------------------- | ---------------------------------------------------------- |
| Testes Vitest                     | **PASS** — 64 arquivos, 445 testes                         |
| TypeScript                        | **PASS** — `tsc --noEmit`                                  |
| ESLint                            | **PASS**                                                   |
| Prettier                          | **PASS**                                                   |
| Build Vite/TanStack cliente e SSR | **PASS**                                                   |
| Auditoria estática do sistema     | **PASS** — 90 APIs, zero achados                           |
| Auditoria de dependências         | **PASS** — zero vulnerabilidades                           |
| Budget de bundle                  | **PASS** — CRM 100.818 B, entrada 253.590 B, CSS 184.769 B |
| Usabilidade automatizada          | **PASS** — 25 telas × 3 viewports = 75 verificações        |
| Fluxo CRM com fixture             | **PASS** — criar lead e mover de etapa                     |
| Menu por teclado                  | **PASS** — foco, Escape e restauração de foco              |
| Recuperação do OAuth Google       | **PASS** — causa, ação, dismiss e alvos de toque           |
| Rotas locais                      | **PASS** — 28 telas, 404 HTML, robots, sitemap e health    |
| API desconhecida local            | **PASS** — HTTP 404 JSON após a correção                   |

### Produção pública e infraestrutura

| Gate                         | Resultado                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| HTTPS, health e readiness    | **PASS** — HTTP 200, modo live, Supabase e Redis `up`                                           |
| Rotas SSR                    | **PASS** — 28/28; 404 HTML, robots e sitemap aprovados                                          |
| Segurança HTTP               | **PASS** — HSTS, CSP com nonce, DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP e CORP |
| TLS                          | **PASS** — TLS 1.3; certificado válido até 19/10/2026; Certbot ativo                            |
| Nginx                        | **PASS** — sintaxe aprovada; avisos não relacionados em três landing pages do host              |
| Containers                   | **PASS** — app, webhooks, scheduler e Redis healthy; zero reinícios                             |
| Hardening                    | **PASS** — usuários sem privilégio, rootfs somente leitura, `cap_drop=ALL`, `no-new-privileges` |
| Exposição de portas          | **PASS** — app em `127.0.0.1:4194`; somente Nginx em 80/443                                     |
| Recursos                     | **PASS** — disco 47%; app 172 MiB; workers ~113/108 MiB; Redis 12 MiB                           |
| Logs recentes                | **PASS** — zero falhas agregadas em app, webhooks e scheduler nos 60 min observados             |
| Backup de 02/09              | **PASS** — SHA-256 verificado                                                                   |
| Dependências da imagem ativa | **FAIL** — 12 vulnerabilidades altas                                                            |

### Autenticação, APIs e módulos

Sem sessão, as APIs de IA, Meta, n8n, contatos, CRM, calendário, go-live e
auditoria responderam HTTP 401. O challenge Meta com token errado respondeu 403.

Com a conta técnica do próprio container, sem imprimir credenciais nem dados de
cliente:

| Área                                      | Resultado                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Dashboard, Inbox, Contatos e tags         | **PASS** — HTTP 200                                                                           |
| CRM/Pipeline                              | **PASS** — HTTP 200; 1 pipeline, 6 etapas e 1 lead no workspace técnico                       |
| Gatilhos, sequências e Automation Studio  | **PASS** — HTTP 200                                                                           |
| Campanhas, conteúdo, insights e auto-like | **PASS** — HTTP 200                                                                           |
| Calendário unificado                      | **PASS** — HTTP 200 com intervalo válido                                                      |
| CRUD de evento, tarefa, agenda e booking  | **PASS** — smoke autocontido com limpeza                                                      |
| Idempotência e buffer de agenda           | **PASS**                                                                                      |
| IA                                        | **PASS parcial** — sugestão real HTTP 200, OpenAI `gpt-5.6-sol`; sem OmniRoute                |
| Meta/Instagram                            | **PASS** — duas contas, token vigente, identidade, mídia, quota e subscriptions válidas       |
| WhatsApp                                  | **PASS técnico / PENDENTE operacional** — challenge e HMAC aprovados; nenhuma conta conectada |
| Google Workspace                          | **FAIL operacional** — plataforma configurada, zero conexões                                  |
| n8n                                       | **PASS funcional / FAIL de manutenção** — conectado, 17 entregas recentes concluídas          |
| Webhooks observados                       | **PASS** — 203 processados, zero falhas, zero itens na fila                                   |
| Go-live                                   | **PASS técnico** — 13 checks, zero falhas; três kill switches ativos                          |
| SLO operacional                           | **FAIL** — HTTP 500 por RPC ausente                                                           |
| Auditoria da aplicação                    | **PASS** — HTTP 200                                                                           |

### Webhooks e limites

| Caso                                            | Resultado |
| ----------------------------------------------- | --------- |
| Challenge Instagram e WhatsApp com token válido | 200       |
| Token de challenge inválido                     | 403       |
| HMAC inválido Instagram/WhatsApp                | 401       |
| HMAC válido com envelope vazio                  | 200       |
| Content-Type assinado incorreto                 | 415       |
| Corpo assinado acima de 1 MiB                   | 413       |
| Wal Chat inbound n8n sem credencial             | 401       |
| n8n Event Gateway sem Header Auth               | 403       |
| Conexão n8n inexistente                         | 404       |

## Correção implementada durante a homologação

Foi criada a rota catch-all `src/routes/api/$.ts`. Ela responde qualquer método
HTTP desconhecido sob `/api/*` com `404`, JSON sanitizado e `Cache-Control:
no-store`. O smoke de rotas agora impede regressão. A auditoria estática foi
ajustada apenas para reconhecer esse fallback constante como endpoint público
sem I/O.

## UX: alcance e limite da validação

A bateria automatizada do candidato cobriu mobile `375×812`, landscape
`812×375` e desktop `1440×900`, verificando H1/main, skip link, overflow,
controles sem nome, alvos abaixo de 44 px, navegação por teclado e dois fluxos
críticos. A landing de produção foi inspecionada no navegador e mantém estrutura
semântica, rótulos e links legais.

A credencial de demonstração documentada não autenticou na interface pública.
Portanto, as telas autenticadas da **release publicada** foram validadas por API,
enquanto a validação visual completa ocorreu no candidato local com fixtures. Um
usuário QA dedicado deve ser criado para o último aceite visual em produção.

## Ordem de liberação recomendada

1. Congelar expansão de tráfego e preservar os kill switches como estão até a
   janela de manutenção ser aprovada.
2. Gerar backup completo novo e verificar checksum, dump e manifesto.
3. Consolidar o worktree em uma release única; aplicar todas as migrations em
   staging, inclusive SLO e CTWA.
4. Reexecutar 445 testes, auditorias, build e smoke autocontido.
5. Rebuild da imagem e confirmar `npm audit --omit=dev = 0` dentro do container.
6. Promover app, worker e scheduler; confirmar fallback 404 e `/api/operations/slo`.
7. Configurar o Google OAuth para produção e conectar uma conta piloto.
8. Atualizar e endurecer o n8n após export/backup e ensaio de compatibilidade.
9. Implantar OmniRoute em rede de produção, testar pelo menos dois provedores e
   um cenário real de fallback; não há “tokens infinitos”, apenas roteamento e
   limites separados por provedor.
10. Conectar uma conta WhatsApp piloto e executar um único teste controlado com
    destinatário autorizado antes de liberar templates ou campanhas.

## Critério para mudar para GO

O parecer muda para **GO** somente quando todos os P0 e P1 estiverem fechados,
as migrations aplicadas coincidirem com o código da imagem, o `npm audit` da
imagem ativa estiver limpo, Google e OmniRoute tiverem prova funcional e o
aceite visual autenticado for concluído. O primeiro envio real deve continuar
exigindo um destinatário piloto explicitamente autorizado.

Referências operacionais externas:

- n8n estável: <https://github.com/n8n-io/n8n/releases>;
- auditoria oficial do n8n: <https://docs.n8n.io/hosting/securing/security-audit/>.
