# Auditoria de pré-produção, segurança, funções e SEO — 20/08/2026

## Decisão executiva

O Wal Chat está **aprovado para testes internos e piloto controlado em
homologação**. Continua **NO-GO para disparos externos em massa, publicação,
auto-like e IA autônoma** enquanto `DEMO_MODE=true`, as credenciais externas não
forem homologadas e os módulos parciais listados neste documento não tiverem
backend concluído.

Esta decisão separa três estados que não podem ser misturados:

- **funcional**: persistência, autorização, API e teste executável existem;
- **piloto**: backend existe, mas depende de credencial/ativo externo e
  supervisão humana;
- **protótipo**: a interface existe, porém o efeito completo não está
  implementado; a UI bloqueia ações que poderiam parecer reais.

## Escopo revisado

- 44 arquivos de API TanStack Start;
- autenticação Supabase, workspaces, papéis, RLS e GRANTs;
- Instagram, WhatsApp, webhooks, filas, workers, scheduler e gateway de envio;
- OpenAI/Gemini, agentes e base de conhecimento;
- CRM, Inbox, gatilhos, Comment-to-DM e calendário/Google;
- rotas públicas, autenticação, páginas legais e exclusão LGPD;
- Docker, servidor Node, cabeçalhos HTTP, secrets e readiness;
- acessibilidade, mobile, conversão, metadados, sitemap e robots;
- testes, build SSR, dependências e documentação operacional.

## Evidências automatizadas

| Verificação                                 | Resultado local                   |
| ------------------------------------------- | --------------------------------- |
| TypeScript (`npx tsc --noEmit`)             | aprovado                          |
| ESLint (`npm run lint`)                     | aprovado                          |
| Vitest                                      | 23 arquivos / 70 testes aprovados |
| Build cliente + SSR                         | aprovado                          |
| Dependências de produção                    | zero vulnerabilidades conhecidas  |
| Dependências completas                      | zero vulnerabilidades conhecidas  |
| Auditoria estática (`npm run audit:system`) | 44 APIs, zero achados bloqueantes |
| Leitura JSON direta sem limite              | zero ocorrências nas APIs         |
| Secrets versionados                         | nenhum secret real encontrado     |
| Diff inválido (`git diff --check`)          | aprovado                          |

O script `scripts/audit-system.mjs` falha quando encontra API privada sem
autenticação, mutação privada sem validação de origem, `request.json()` sem
limite ou ausência de robots/sitemap/OG/manifest.

## Falhas encontradas e tratadas

| Severidade | Falha                                                             | Correção                                                                   |
| ---------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Alta       | nove mutações do CRM usavam `request.json()` sem limite           | todas usam `readJsonBody`, com Content-Type e limite de bytes              |
| Alta       | formulário público de exclusão mostrava sucesso sem gravar pedido | API real, tabela service-role-only, rate limit, honeypot e protocolo opaco |
| Alta       | endpoint de preview de compliance era público e sem limite        | autenticação do workspace, origem confiável e rate limit por usuário       |
| Média      | disponibilidade pública podia acionar Free/Busy sem rate limit    | limite distribuído também no GET de horários                               |
| Média      | telas parciais mostravam estados e métricas como se fossem reais  | avisos explícitos, contadores zerados e botões externos desabilitados      |
| Média      | sidebar exibia badge e elegibilidade fictícios                    | estado Meta real e identidade derivada do usuário autenticado              |
| Média      | páginas privadas não declaravam exclusão de indexação             | layout autenticado agora usa `noindex, nofollow, noarchive`                |
| Média      | página inexistente não oferecia recuperação navegável             | 404 própria com status, início/painel/manual e layout responsivo           |
| Média      | CSP não cobria GA/Maps e faltavam cabeçalhos modernos             | origens condicionais, COOP, CORP, Origin-Agent-Cluster, HSTS ampliado      |
| Baixa      | XML era servido como `application/octet-stream`                   | MIME `application/xml; charset=utf-8`                                      |

## Itens de conversão, SEO, confiança e lei

| #   | Item solicitado            | Implementação                                                                 |
| --- | -------------------------- | ----------------------------------------------------------------------------- |
| 1   | Página 404                 | `NotFoundPage`, retorno útil e status 404 validado pelo smoke HTTP            |
| 2   | CTA acima da dobra         | CTA no hero e formulário visível no primeiro viewport                         |
| 3   | Links internos             | recursos, casos, FAQ, localização e páginas legais com links rastreáveis      |
| 4   | Página de obrigado         | `/obrigado`, próximos passos e `noindex`                                      |
| 5   | Mapa do site               | `/sitemap.xml` somente com URLs públicas indexáveis                           |
| 6   | Cases de sucesso           | casos de uso tecnicamente validados; sem métricas comerciais inventadas       |
| 7   | Cinco FAQs                 | cinco objeções reais em `details/summary` acessível                           |
| 8   | Tempo de resposta          | promessa pública configurável por ambiente                                    |
| 9   | CTA fixo mobile            | botão com safe-area; não aparece no desktop                                   |
| 10  | robots.txt                 | bloqueia APIs, painel e rotas transitórias; referencia sitemap                |
| 11  | Títulos únicos             | rotas públicas têm `title` próprio; painel muda título e permanece noindex    |
| 12  | Meta descriptions          | descrições específicas em home, legais, booking e obrigado                    |
| 13  | Imagem de compartilhamento | OG/Twitter absolutos, `og:image:alt` e cartão 1200×630 existente              |
| 14  | Mapa e como chegar         | componente e envs prontos; mapa só aparece com endereço real configurado      |
| 15  | Avaliações reais           | tabela/API publicam apenas registro verificado, consentido e publicado        |
| 16  | Alt em imagens             | imagem social tem descrição; thumbnail de mídia mantém alt contextual         |
| 17  | Schema local               | Organization + SoftwareApplication; LocalBusiness condicional a endereço real |
| 18  | Política de privacidade    | LGPD, Meta, OpenAI/Google, cookies, IA e canal do encarregado atualizados     |
| 19  | Google Analytics           | GA4 em consentimento básico; nenhuma tag carrega antes do aceite              |

### Dados que não foram inventados

Não há endereço comercial confirmado, ID GA4 nem avaliações autorizadas neste
repositório. Por isso:

- LocalBusiness e mapa ficam desativados até preencher os envs públicos;
- Analytics fica desativado até definir um Measurement ID `G-*`;
- não existe `aggregateRating` nem estrelas em JSON-LD sem avaliações reais;
- a landing mostra provas técnicas e declara quando o piloto ainda está
  coletando avaliações.

## Matriz funcional

| Área                           | Estado              | Limite atual                                                              |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------- |
| Auth, workspaces, papéis e RLS | funcional           | política de senha forte também deve ser aplicada no painel Supabase       |
| Dashboard                      | funcional/parcial   | alcance depende da ingestão oficial de Insights                           |
| Central de Go-Live             | funcional           | ativação externa continua decisão humana                                  |
| Instagram e WhatsApp           | piloto              | Meta App, ativos de teste e permissões ainda não configurados no ambiente |
| Webhooks e observabilidade     | funcional           | teste externo final depende da assinatura real da Meta                    |
| Inbox e envio humano           | piloto              | usar somente conta de teste após gates aprovados                          |
| Contatos e Tags                | funcional           | CRM e ações em lote homologados                                           |
| Gatilhos e Comment-to-DM       | piloto              | uma regra curta, conta de teste e supervisão                              |
| Sequências                     | parcial             | scheduler possui políticas; editor CRUD/versionamento permanece pendente  |
| Agentes e conhecimento         | piloto              | requer OpenAI/Gemini; começar por copiloto                                |
| Reengajamento                  | protótipo bloqueado | campanha, aprovação, fila e cancelamento pendentes                        |
| Calendário e booking           | funcional           | Google externo depende de Client ID/Secret e conta piloto                 |
| Publicar                       | protótipo bloqueado | upload, containers, agendamento e publish Meta pendentes                  |
| Auto-like                      | protótipo bloqueado | persistência, auditoria e reação Meta pendentes                           |
| Insights                       | protótipo bloqueado | ingestão, histórico, heatmap e análise reais pendentes                    |
| Site público/SEO/LGPD          | funcional           | GA, endereço e avaliações dependem de dados reais do negócio              |

## Controles de backend confirmados

- bearer JWT validado antes de qualquer contexto privado;
- seleção de workspace por membership e papéis `owner/admin/agent/viewer`;
- RLS no cliente request-scoped e service role somente depois da autorização;
- validação de origem nas mutações do navegador;
- Zod, Content-Type e limite de corpo;
- rate limit Redis com falha fechada em live;
- HMAC SHA-256 em webhooks e `timingSafeEqual`;
- OAuth Meta/Google com state; Google também usa PKCE e cookie HttpOnly;
- credenciais persistidas em AES-256-GCM e nunca devolvidas ao cliente;
- idempotência de webhooks, jobs, private reply, entrega e booking;
- gateway único reaplica janela, opt-out, cooldown e rodapé antes de enviar;
- entrega ambígua não é repetida automaticamente;
- readiness distingue processo vivo de Supabase/Redis realmente disponíveis;
- containers sem root, read-only, `cap_drop ALL`, limites de CPU/memória/PIDs e
  logs rotacionados.

## Pendências obrigatórias antes de chamar de produção real

1. configurar aplicativo Meta, Instagram Professional, WABA, telefone, templates
   e permissões aprovadas;
2. configurar OpenAI ou Gemini com limite financeiro e executar avaliações do
   copiloto;
3. configurar Google OAuth e executar a matriz externa de Calendar/Tasks/Meet;
4. configurar SMTP transacional para confirmação automática de pedidos LGPD e
   alertas operacionais;
5. definir GA4, email real, endereço/horário/Maps — somente se publicáveis;
6. cadastrar avaliações somente com evidência e consentimento;
7. concluir os cinco módulos parciais antes de liberar seus efeitos;
8. migrar a homologação Supabase para operação gerenciada/self-hosted com
   backup, atualização, SMTP e monitoramento formais;
9. manter `DEMO_MODE=true` e kill switches desligados até todos os gates estarem
   verdes.

## Roteiro da próxima fase de testes

1. criar usuário nominal; proibir conta compartilhada;
2. testar owner, admin, agent e viewer em dois workspaces;
3. conectar somente ativos Meta de teste;
4. validar challenge e assinatura inválida/válida dos dois webhooks;
5. receber comentário, DM e WhatsApp e confirmar deduplicação;
6. enviar uma resposta humana dentro da janela;
7. responder `PARAR` e comprovar bloqueio posterior;
8. testar Comment-to-DM repetido e cooldown;
9. testar agente somente em copiloto e registrar fontes;
10. conectar Google piloto, reservar, editar, excluir e revogar;
11. registrar pedido LGPD e acompanhar o protocolo no banco;
12. validar 404, sitemap, robots, metadados e mobile;
13. manter campanhas, publicação, auto-like e IA autônoma desligados.

## Operação e rollback

Antes de uma release:

1. gerar dump do banco e SHA-256;
2. validar migration em clone isolado;
3. executar tipos, lint, testes, build, audits e smoke;
4. subir uma nova pasta em `/opt/wal-chat/releases` sem sobrescrever a anterior;
5. aplicar migration e verificar o histórico;
6. recriar a stack, aguardar healthchecks e executar smoke HTTP;
7. em falha, restaurar o compose da release anterior; restaurar banco somente
   quando houver mudança incompatível comprovada.

## Referências no repositório

- `README.md`
- `docs/AUDITORIA_BACKEND_CORE_2026-08-20.md`
- `docs/SEGURANCA_E_COMPLIANCE.md`
- `docs/CONFIGURACAO_META_E_OPENAI.md`
- `docs/CONFIGURACAO_GOOGLE_CALENDAR.md`
- `docs/MANUAL_COMPLETO_ACESSOS_OPERACAO_CONFIGURACAO.md`
- `scripts/audit-system.mjs`
- `scripts/validate-routes.mjs`

## Evidência da publicação — 20/08/2026

A release `/opt/wal-chat/releases/20260820-security-seo-v1`, commit final
`fa8395f`, foi publicada em
`https://wal-chat.64.181.178.125.nip.io`. A stack permaneceu em
`DEMO_MODE=true`; nenhuma credencial externa foi adicionada e nenhum disparo
Meta, WhatsApp ou IA foi habilitado.

| Verificação                | Resultado                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup pré-migração        | `20260820-before-security-seo-512b427.dump`, 650.640 bytes, 1.246 entradas legíveis                                                                                                                              |
| SHA-256                    | `91d1d513f7e81410b2044447762e221c086c4ccf5a2648cadbc9ab3d9daf1746`                                                                                                                                               |
| Migração isolada           | tabelas criadas; RLS ativo; zero GRANTs para `anon`/`authenticated`; publicação sem consentimento rejeitada                                                                                                      |
| Restore integral de ensaio | o dump Supabase contém funções Realtime que exigem `log_min_messages`; o papel local não pode recriá-las. O dump foi validado com `pg_restore --list`; o ensaio desta migration aditiva usou banco isolado limpo |
| Migração publicada         | `20260821010000 public_privacy_reviews` registrada no histórico                                                                                                                                                  |
| Serviços                   | app, worker de webhooks, scheduler e Redis saudáveis                                                                                                                                                             |
| Rotas                      | 20 rotas SSR `200`, 404 real, titles públicos únicos, robots, sitemap e health aprovados                                                                                                                         |
| Backend                    | auditoria de 44 APIs sem achados; compliance sem JWT `401`; mutação LGPD cross-origin `403`                                                                                                                      |
| LGPD                       | criação, protocolo, consulta e limpeza exata do pedido QA aprovadas; zero resíduo                                                                                                                                |
| Qualidade                  | TypeScript, ESLint, Prettier, build e 23 arquivos/70 testes aprovados; `npm audit --omit=dev` com zero vulnerabilidades conhecidas                                                                               |
| Navegador                  | hero/CTA, navegação interna, cases técnicos, avaliações verificadas, FAQ, localização condicional, 404 e metadados inspecionados; zero warnings/errors de console                                                |
| Logs                       | zero ocorrências recentes de `unhandled`, `fatal`, `uncaught` ou `error:` nos três processos Node                                                                                                                |

O controle de viewport do navegador interno não alterou as dimensões durante
este ensaio; por isso a evidência nova não declara um teste visual 390×844. Os
breakpoints, o CTA móvel e a ausência de overflow continuam cobertos pelo CSS e
pela validação mobile da release anterior, mas devem ser repetidos em aparelhos
reais na próxima bateria.
