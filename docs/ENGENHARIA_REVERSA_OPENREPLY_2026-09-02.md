# Engenharia reversa do OpenReply e plano de incorporação no Wal Chat

- Data da análise: 2026-09-02
- Repositório analisado: `diwenne/openreply`
- Commit analisado: `d97e293834fdb76054e5cabfca61225476571267`
- Clone local integral: `H:\Documentos\F.A.T Tech 2026\Mano Chat - Personalizado\openreply`

## 1. Escopo e método

O repositório foi clonado por inteiro e estudado antes de qualquer alteração na base do Wal Chat. A análise incluiu:

- inventário dos 171 arquivos e de aproximadamente 20 mil linhas de aplicação, banco, worker e testes;
- leitura do README, instalação, stack, notas de App Review, esquema Prisma e 18 migrações;
- rastreamento dos fluxos de webhook, fila, Private Reply, resposta pública, postback, DM, links, relatórios, seguidores e reconciliação por polling;
- instalação reprodutível das dependências e geração do Prisma Client;
- execução de `typecheck`, `lint`, 168 testes e build de produção;
- comparação funcional e arquitetural com o Wal Chat atual.

Resultado técnico da reprodução:

| Verificação   | Resultado                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Prisma Client | gerado com Prisma 7.8.0                                                                        |
| TypeScript    | aprovado                                                                                       |
| ESLint        | aprovado                                                                                       |
| Testes        | 15 arquivos e 168 testes aprovados                                                             |
| Build Next.js | aprovado, 52 páginas/rotas                                                                     |
| Dependências  | 560 pacotes; o instalador reportou 23 vulnerabilidades conhecidas, sendo 3 críticas e 15 altas |

Nenhuma dependência do OpenReply será copiada para o Wal Chat. Os padrões selecionados serão reimplementados sobre a stack e os controles existentes.

## 2. Licença e origem

O OpenReply usa licença MIT. Os avisos de copyright abrangem Anish Raj e Diwen Huang, ambos em 2026. O projeto informa que partiu de `instagram-comment-to-dm` e foi ampliado posteriormente.

Esta integração adota ideias, fluxos e critérios observáveis, sem importar o framework, o banco ou pacotes do projeto. Qualquer trecho substancial que venha a ser adaptado literalmente deve manter o aviso MIT em `THIRD_PARTY_NOTICES.md`.

## 3. Arquitetura reconstruída

### 3.1 Componentes

| Camada                   | OpenReply                                       |
| ------------------------ | ----------------------------------------------- |
| Aplicação e API          | Next.js 16.2.6, App Router e React 19.2.4       |
| Persistência             | PostgreSQL via Prisma 7.8                       |
| Processamento assíncrono | BullMQ 5 e Redis via ioredis                    |
| Autenticação             | Auth.js/NextAuth com magic link por e-mail      |
| Validação                | Zod 4                                           |
| Interface                | Tailwind CSS 4 e Recharts 3                     |
| Integração social        | Instagram Graph API oficial com Instagram Login |
| Execução                 | web/API e worker Node sempre ativo              |

O processo web autentica usuários, recebe webhooks, serve o painel e grava trabalhos na fila. O worker consome a fila, aplica correspondência e limites, chama a Meta e executa o polling de segurança. PostgreSQL e Redis são compartilhados pelos dois processos, inclusive a mesma chave de criptografia.

### 3.2 Modelo de dados

As entidades principais são:

- identidade: `User`, `Account`, `Session` e `VerificationToken`;
- multiempresa: `Workspace`, `WorkspaceMember` e `WorkspaceInvitation`;
- Meta: `InstagramAccount` e `FollowerSnapshot`;
- automação: `Automation`, `DmLog` e `ProcessedComment`;
- atribuição: `TrackedLink` e `LinkClick`;
- operação: `WebhookEvent` e `OperationalEvent`.

`Automation` reúne num único registro o alvo da publicação, as palavras, mensagem privada, abertura por botão, barreira de seguidor, follow-up, resposta pública, links rastreados e compartilhamento de relatório. É simples para um produto focado, mas menos flexível que o DAG versionado do Wal Chat.

### 3.3 Fluxo comentário para DM

1. A Meta envia um evento `comments`.
2. A assinatura HMAC SHA-256 é validada contra um dos segredos configurados.
3. O payload bruto é persistido como `WebhookEvent`.
4. Comentários do próprio perfil são descartados.
5. O evento entra no BullMQ com identificador determinístico por conta e comentário.
6. O worker localiza campanhas ativas pelo `mediaId`, `original_media_id` ou modo “qualquer post”.
7. O texto é normalizado e comparado às palavras da campanha.
8. Uma resposta pública opcional é enviada e registrada independentemente da DM.
9. A regra de uma única Private Reply por comentário é verificada entre campanhas.
10. Cota do workspace e limite horário da conta são reservados.
11. A Private Reply é enviada como texto, botão de abertura ou botões de link.
12. O resultado fica em `DmLog`, com tentativas e motivo da falha ou descarte.

### 3.4 Abertura, barreira de seguidor e revelação

Uma campanha pode começar com uma Private Reply contendo botão de postback. O clique abre a conversa e produz `reveal:<automationId>` ou `followcheck:<automationId>`:

- com barreira de seguidor, o worker consulta `is_user_follow_business` pelo IGSID;
- não seguidores recebem novamente o pedido para seguir;
- seguidores recebem a mensagem final e até três botões de URL;
- quando a Meta não retorna o estado no postback, o código entrega o conteúdo; no primeiro contato, estado desconhecido não entrega;
- um follow-up opcional é agendado com ID determinístico por automação e usuário.

Há ainda uma tentativa especulativa após recibo de leitura: cinco minutos depois, o sistema tenta revelar o conteúdo se não houve clique. O próprio código admite que a janela geralmente permanece fechada. Este comportamento não será trazido ao Wal Chat porque cria tentativa de envio com pouca previsibilidade e não acrescenta uma garantia funcional.

### 3.5 Gatilho por DM e Story reply

Mensagens recebidas são filtradas para excluir ecos, exclusões, conteúdo sem texto e mensagens não suportadas. Campanhas com `dmTriggerEnabled` usam as mesmas palavras. Como já existe uma conversa iniciada pelo usuário, a resposta é DM normal, preservando a barreira de seguidor e a deduplicação por ID da mensagem.

### 3.6 Links e relatórios

O primeiro URL de uma mensagem pode virar `{link}`. A entrega usa `/r/<slug>`; o redirecionador registra hash do IP, user-agent e referrer antes de responder 302. O relatório público por slug mostra enviados, descartados, falhas, cliques, CTR, palavras principais, série de sete dias e cliques por link.

O Wal Chat já tem links `ig.me` com `ref`, atribuição ao contato e vínculo a um fluxo. Eles medem conversas atribuídas, não cliques de saída. As duas abordagens são complementares e não devem compartilhar o mesmo nome de métrica.

### 3.7 Reconciliação de comentários

O worker varre campanhas ativas em uma janela padrão de 72 horas:

- post específico: consulta o post e eventuais IDs de anúncio derivados dele;
- qualquer post: consulta as dez mídias mais recentes;
- pagina até 800 comentários recentes por mídia;
- ignora o próprio perfil, palavras sem correspondência e comentários que já tenham resposta do perfil;
- ordena os restantes do mais antigo para o mais novo;
- envia no máximo 30 novos trabalhos por campanha a cada varredura.

Para posts impulsionados, `original_media_id` liga o anúncio ao post orgânico. Os IDs de mídia do anúncio são descobertos nos webhooks armazenados dos últimos 90 dias, evitando pedir `ads_management`.

O modelo `ProcessedComment` é descrito como conjunto compartilhado de deduplicação, mas não é usado pelo código analisado. Na prática, a proteção depende de `DmLog`, da resposta pública existente e dos IDs do BullMQ. Comentários sem match podem ser relidos em todos os ciclos. A versão do Wal Chat deve corrigir essa divergência, sem copiar o modelo morto.

### 3.8 Histórico de seguidores

O OpenReply trata `follower_count` de insights como variação diária, não como total absoluto. Para uma conta recém-conectada:

1. obtém o total atual em `/me`;
2. consulta até 30 dias de variações diárias;
3. reconstrói os totais de trás para frente;
4. marca linhas derivadas como `backfilled`;
5. um snapshot observado substitui a estimativa daquele dia;
6. uma rotina diária preserva histórico além da retenção da Meta.

Esta lógica corrige uma lacuna real do Wal Chat: hoje `insights_daily.followers` recebe diretamente o valor diário de `follower_count`, o que pode representar variação em vez de total.

### 3.9 “Próximo Reel”

Uma automação pode ficar em `pendingNextReel`. Como não há webhook usado pelo projeto para publicação nova, uma rotina busca as 25 mídias recentes e vincula a campanha ao primeiro Reel publicado após sua criação. O agrupamento por conta evita chamadas duplicadas.

### 3.10 Templates e importação

Existem oito templates: produto DTC, imóveis, fitness, webinar/curso, beleza, restaurante, evento e mídia kit. Cada um contém audiência, objetivo, palavras, mensagem, playbook e métricas. A importação aceita até 200 campanhas, valida com Zod e evita duplicar o mesmo post na conta.

## 4. Controles de qualidade e segurança observados

Pontos positivos:

- uso exclusivo da API oficial, sem senha do Instagram e sem scraping;
- HMAC com comparação em tempo constante;
- AES-256-GCM para o token da conta;
- OAuth state assinado e com validade curta;
- IDs determinísticos na fila e `upsert` para resultados;
- reserva atômica no Redis antes da Private Reply;
- isolamento da resposta pública em relação à DM;
- fallback de template de botão para texto, limitado a rejeições compatíveis;
- filtragem de eco e de comentários do próprio perfil;
- papéis de workspace e validação de vínculo da conta.

Riscos e limitações que não devem ser copiados:

- dependências instaladas com 23 alertas conhecidos, incluindo 3 críticos e 15 altos;
- ausência de RLS no banco; o isolamento de tenant depende integralmente da aplicação;
- convites guardam token reutilizável em texto, em vez de somente hash;
- webhooks completos e metadados de clique podem ficar armazenados sem política de retenção explícita;
- tentativa inválida de webhook grava os primeiros 200 caracteres do corpo em evento operacional;
- relatório compartilhado nasce habilitado, sem validade ou rotação visível;
- obtenção de IP confia em headers de proxy sem uma lista de proxies confiáveis;
- contador horário usa janela fixa e teto sem margem operacional;
- a reserva do limite não é devolvida quando a Meta recusa a chamada, o que é conservador mas pode reduzir capacidade;
- `ProcessedComment` existe no esquema e nos comentários de arquitetura, mas não é consumido;
- o fallback de recibo de leitura tenta uma DM que frequentemente está fora da janela válida;
- links importados são aceitos por prefixo HTTP(S), sem política comum de destinos ou bloqueio de hosts internos;
- compartilhamento público divulga nome do workspace e conta do Instagram por padrão.

## 5. Comparação com o Wal Chat

| Capacidade                        | OpenReply                                    | Wal Chat antes desta integração                      | Decisão                                    |
| --------------------------------- | -------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Comment-to-DM                     | focado e completo                            | já existe com compliance, kill switch e idempotência | manter Wal Chat                            |
| Gatilhos DM/Story                 | sim                                          | já existe                                            | manter Wal Chat                            |
| Automação                         | campanha linear                              | DAG versionado, menus, espera, integrações           | manter Wal Chat                            |
| WhatsApp                          | não                                          | sim                                                  | manter Wal Chat                            |
| CRM, equipe e IA                  | básico/ausente                               | amplo e integrado                                    | manter Wal Chat                            |
| Webhook/outbox                    | BullMQ e log                                 | fila, outbox persistente, replay e heartbeat         | manter Wal Chat                            |
| Correspondência Unicode           | avançada                                     | lowercase local e substring/exato                    | incorporar                                 |
| Polling de comentários perdidos   | sim                                          | reconcilia a fila, não a origem Meta                 | incorporar                                 |
| Post impulsionado                 | `original_media_id` e descoberta de ad media | só `media.id`                                        | incorporar                                 |
| Limite de Private Reply por conta | 750/h no Redis                               | limites gerais, sem reserva exclusiva deste endpoint | incorporar com margem configurável         |
| Histórico absoluto de seguidores  | snapshot + backfill                          | sete dias sem distinção clara entre delta e total    | incorporar                                 |
| Próximo Reel                      | sim                                          | publicação/sincronização existem, alvo futuro não    | incorporar                                 |
| Resposta pública variável         | sim                                          | Comment-to-DM envia somente DM                       | planejar depois; requer política própria   |
| Links de saída/CTR                | sim                                          | links de entrada `ig.me` e atribuição                | complementar em fase separada              |
| Relatório público                 | sim                                          | dashboards autenticados                              | fase separada, opt-in, expirável e sem PII |
| Templates de campanha             | oito presets                                 | templates de automação e CRM                         | traduzir conceitos, sem duplicar catálogo  |
| Recibo de leitura como fallback   | sim                                          | não                                                  | rejeitar                                   |

## 6. Incorporação definida

### Fase implementada nesta atualização

1. Normalização de palavras com Unicode e equivalência segura de diacríticos latinos.
2. Reconhecimento de `original_media_id` para comentário em post impulsionado.
3. Reconciliação periódica de comentários recentes diretamente na Meta, com limites por varredura e reaproveitamento do pipeline idempotente do Wal Chat.
4. Reserva atômica, específica por conta, antes de cada Private Reply; falha fechada em produção quando Redis não está disponível.
5. Snapshots diários e reconstrução de totais de seguidores, sem sobrescrever observações reais com estimativas.
6. Alvo “próximo Reel” para Comment-to-DM, ligado automaticamente depois da publicação.
7. Telemetria operacional dessas varreduras e status visível na configuração.

### Fase posterior recomendada

- links de saída por campanha com redirect próprio, consentimento/retention e CTR autenticado;
- relatório compartilhável opt-in, com expiração, rotação e conteúdo agregado;
- variações de resposta pública com limite próprio;
- importação CSV apoiada no mesmo contrato de gatilhos, com prévia e transação;
- catálogo de templates em português orientado aos segmentos reais dos workspaces.

## 7. Princípios da reimplementação

- preservar a RLS e o isolamento por workspace do Wal Chat;
- continuar usando credenciais cifradas e exclusivamente server-side;
- não armazenar novos payloads brutos nem PII para implementar polling;
- fazer polling por conta, agrupar requisições e limitar volume;
- passar comentários recuperados pelo mesmo pipeline de ingestão, cooldown, compliance, idempotência e auditoria dos webhooks;
- não reenviar entregas de estado `unknown`;
- separar indisponibilidade da Meta de ausência de dados;
- manter todos os recursos novos desligáveis e observáveis.

## 8. Critérios de aceite

- `PREÇO`, `preco` e `preço` casam com uma palavra latina equivalente, sem mutilar alfabetos não latinos;
- um comentário de anúncio com `original_media_id` encontra a regra do post orgânico;
- uma falha de webhook pode ser recuperada por polling sem duplicar interação ou Private Reply;
- a varredura não processa comentário do próprio perfil, fora da janela, acima do teto ou sem regra compatível;
- o limite por conta é reservado de forma atômica antes da chamada externa;
- em produção, Redis indisponível bloqueia Private Reply em vez de liberar volume sem controle;
- o histórico distingue snapshot observado de total reconstruído;
- uma regra “próximo Reel” se vincula somente ao primeiro Reel publicado depois de criada;
- APIs mantêm autenticação, papéis, origem confiável, validação estrita e `Cache-Control: no-store` quando aplicável;
- lint, formatação, testes, rotas e build permanecem aprovados.

## 9. Evidências da implementação no Wal Chat

| Verificação                | Resultado                                                |
| -------------------------- | -------------------------------------------------------- |
| Prettier                   | aprovado                                                 |
| ESLint                     | aprovado                                                 |
| TypeScript                 | aprovado sem emissão                                     |
| Vitest                     | 54 arquivos e 366 testes aprovados                       |
| Build Vite cliente e SSR   | aprovado                                                 |
| Smoke HTTP                 | 28 rotas, health, robots, sitemap e página 404 aprovados |
| `git diff --check`         | aprovado                                                 |
| Supabase `db lint --local` | não executado: Docker local não estava ativo             |

A migration foi revisada de forma estática, mas deve passar pelo linter e ser
aplicada primeiro em homologação antes de qualquer publicação. Esta atualização
não executa deploy nem altera o banco de produção.
