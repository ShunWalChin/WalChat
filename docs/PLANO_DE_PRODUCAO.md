# Plano de produção do Wal Chat

Este documento separa o que já existe, o que ainda bloqueia contas reais e a ordem segura para promover o Wal Chat de homologação a produção. Nenhum gate deve ser interpretado como autorização automática para migração, troca de secrets ou deploy.

## Estado atual

- A aplicação, o webhook, OAuth Meta, Inbox, compliance, agentes de IA, Redis, worker e scheduler possuem implementação backend.
- A homologação pública continua em `DEMO_MODE=true`; portanto, não deve enviar mensagens reais.
- O ambiente atual usa Supabase CLI isolado. Ele atende ao desenvolvimento e à homologação temporária, mas não é a topologia de banco recomendada para produção.
- O calendário operacional possui persistência, Google Calendar/Tasks,
  Free/Busy, Meet e agendamento público; a conexão externa ainda depende das
  credenciais OAuth do ambiente e da matriz de homologação.
- Publicação editorial na Meta, insights e outros módulos visuais ainda têm
  partes demonstrativas e precisam de contratos Graph API e testes próprios
  antes de serem vendidos como funcionais.

## Gates obrigatórios

### Gate 1 — plataforma

- [x] Liveness separado de readiness.
- [x] Readiness real para Supabase e Redis.
- [x] Healthcheck baseado em heartbeat para worker e scheduler.
- [x] Cabeçalhos HTTP de segurança.
- [x] Pipeline CI com tipos, lint, formato, testes, build, audit e imagem Docker.
- [x] Webhook falha fechado em live quando não consegue enfileirar.
- [ ] Banco de produção gerenciado ou self-hosted oficial, com backup testado.
- [ ] SMTP transacional configurado para confirmação e recuperação de senha.
- [ ] Monitoramento externo, alertas e retenção segura de logs.
- [x] Rate limiting versionado no Nginx para tráfego geral, webhook, OAuth e envio/IA.
- [ ] Rate limiting validado no proxy final; escala horizontal ainda exige borda distribuída.
- [x] Claim persistente/idempotência de DMs manuais e do scheduler.
- [x] Reconciliador Postgres/BullMQ e persistência de falha dos jobs de webhook.
- [ ] Migration de entregas aplicada com backup e fila operacional para estados `unknown`.

### Gate 2 — segurança e dados

- [ ] Rotacionar todas as credenciais que já apareceram em terminal, log ou histórico operacional.
- [ ] Criar secrets exclusivos por ambiente e confirmar que nenhum usa prefixo `VITE_`.
- [ ] Executar teste de isolamento RLS com dois workspaces reais.
- [ ] Documentar e ensaiar restore do banco.
- [ ] Concluir rotina assíncrona de eliminação definitiva de dados.
- [ ] Revisar retenção, consentimento, política, termos e resposta a incidentes.

### Gate 3 — Meta

- [ ] App Meta Business verificado, em Live Mode, com URLs públicas definitivas.
- [ ] Instagram Professional ligado a Página e Business Portfolio corretos.
- [ ] Permissões e recursos aprovados pela App Review para o caso de uso real.
- [ ] Webhook assinado e assinaturas de campos confirmadas.
- [ ] OAuth, reconexão, expiração e revogação validados com uma conta piloto.
- [ ] Matriz de testes da janela de 24 horas, HUMAN_AGENT, opt-out, cooldown e Private Reply aprovada.
- [x] Teste unitário impede replay automático de resposta ambígua.
- [ ] Simular timeout/resposta ambígua em integração controlada com a conta piloto.

### Gate 4 — IA

- [ ] Chave OpenAI ou Gemini armazenada cifrada por workspace.
- [x] Timeout e retry conservador configurados no runtime dos provedores.
- [ ] Limites de custo e orçamento por tenant configurados.
- [ ] Persona e base de conhecimento testadas contra prompt injection e vazamento entre tenants.
- [ ] Modo copiloto validado antes de liberar qualquer modo autônomo.
- [ ] Falhas do provedor nunca geram envio automático inventado.

### Gate 5 — Google Agenda

- [x] CRUD local de eventos, tarefas e reuniões persistente.
- [x] OAuth Authorization Code com state, PKCE e tokens cifrados.
- [x] Reserva transacional e Free/Busy com falha fechada.
- [x] Integração do link oficial com gatilhos, sequências e agentes de IA.
- [ ] OAuth, Calendar, Tasks, Meet e revogação validados com a conta piloto.
- [ ] Dupla reserva e indisponibilidade do Google ensaiadas em homologação.

### Gate 6 — operação

- [ ] Piloto com um workspace, uma conta Professional e usuários nominados.
- [ ] Dashboards e alertas para webhook, fila, scheduler, Meta e IA.
- [ ] Runbooks de desconexão Meta, token expirado, fila parada, incidente de dados e rollback.
- [ ] Critérios objetivos de go/no-go e responsável pela decisão.
- [ ] Suporte e canal de escalonamento definidos.

## Sequência de promoção

1. Criar a infraestrutura de dados de produção sem reaproveitar secrets da homologação.
2. Aplicar migrations por versão, capturando backup e evidência de rollback.
3. Configurar SMTP, Redis persistente, observabilidade e alertas.
4. Fazer deploy com `DEMO_MODE=true` e validar `/api/health`, `/api/ready` e healthchecks dos workers.
5. Configurar Meta, IA e Google Workspace com um workspace piloto.
6. Executar a matriz completa de compliance sem disparo em massa.
7. Autorizar explicitamente a troca para `DEMO_MODE=false`.
8. Liberar tráfego gradualmente, acompanhar erros, fila, bloqueios e custos.

O escopo, as evidências e os checkpoints exatos do primeiro piloto estão em [Validação de produção real V1](VALIDACAO_PRODUCAO_REAL_V1.md).

## Critério de rollback

Rollback é obrigatório quando readiness permanecer indisponível, o webhook perder eventos, houver duplicidade de envio, falha de isolamento entre tenants, segredo exposto ou disparo fora das regras de compliance. A resposta inicial deve desabilitar efeitos externos, preservar evidências e restaurar a última versão aprovada.

## Aprovações separadas

Estas ações exigem confirmação específica no momento de execução:

- criar ou alterar infraestrutura externa;
- aplicar migration em banco compartilhado;
- trocar ou rotacionar credenciais;
- ativar Live Mode ou `DEMO_MODE=false`;
- publicar branch, abrir PR, mesclar ou implantar;
- conectar uma conta Instagram real;
- iniciar qualquer campanha ou envio em massa.
