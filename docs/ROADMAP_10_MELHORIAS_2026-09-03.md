# Roadmap priorizado — 10 melhorias do Wal Chat

Data da avaliação: 03/09/2026

Este documento transforma a auditoria técnica, operacional e de usabilidade em
dez frentes objetivas de trabalho. Ele não declara uma publicação: as mudanças
atuais continuam somente no ambiente local até que os portões P0 sejam
aprovados.

## Leitura executiva

O Wal Chat já possui uma base funcional ampla: 117 arquivos de rota, 84 rotas
de API, isolamento por workspace, CRM com pipeline editável, automações,
Inbox, calendário, IA, Meta, Google, n8n e OCI/CAPI. A suíte atual aprova 402
testes e o `npm audit --omit=dev` não encontrou vulnerabilidades conhecidas no
runtime.

O sistema ainda não está pronto para uma nova publicação. O portão estático
reprova 10 escritas sem verificação no scheduler, a branch local diverge do
GitHub, a auditoria de usabilidade não é determinística sem serviços externos e
o backup mais recente antecede o CRM refinado. A prioridade imediata é tornar a
entrega segura e reproduzível antes de ampliar funcionalidades.

## Diagnóstico resumido

| Dimensão                  | Avaliação                     | Evidência principal                                                            |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| Funcionalidade            | Forte                         | CRM, comunicação, automação, integrações e gestão já cobrem a operação central |
| Segurança de dependências | Aprovada                      | zero vulnerabilidades conhecidas em dependências de produção                   |
| Testes de código          | Forte                         | 58 arquivos e 402 testes aprovados                                             |
| Banco e multitenancy      | Boa                           | 28 migrations e teste comportamental de isolamento entre workspaces no CI      |
| Usabilidade               | Boa, com validação incompleta | revisão manual aprovada; matriz integral depende hoje de serviços externos     |
| Manutenibilidade          | Em atenção                    | `styles.css` tem 11.326 linhas e quatro telas passam de 2.200 linhas           |
| Escala do CRM             | Limitada                      | leitura carrega até 500 leads e 100 contatos no cliente                        |
| Observabilidade           | Parcial                       | há auditoria, retry e replay; faltam alertas externos e SLOs fechados          |
| Entrega                   | Bloqueada                     | auditoria estática reprova com 66 escritas sem verificação, teto 56            |
| Recuperação               | Requer atualização            | backup íntegro de 02/09 não contém todas as mudanças atuais                    |

## Os 10 pontos de melhoria

### 1. Fechar as escritas sem verificação do scheduler — P0

**Por quê:** `npm run audit:system` reprova com 66 escritas sem verificação,
dez acima do teto, todas em `src/workers/scheduler.worker.ts`. Uma falha de
banco pode ser tratada como sucesso e deixar job, entrega ou auditoria em estado
incoerente.

**Trabalho:** capturar e tratar o retorno de cada `insert`, `update` e `delete`;
classificar erro como transitório, terminal ou ambíguo; preservar idempotência;
adicionar testes de falha para cada caminho corrigido.

**Concluído quando:** auditoria do sistema aprovada, zero nova escrita sem
checagem e testes provando que falha de persistência nunca produz sucesso falso.

### 2. Criar uma linha de release única e recuperável — P0

**Por quê:** a branch local tem 29 commits exclusivos e `github/main` tem 25;
o worktree também contém muitas alterações ainda não versionadas. Publicar esse
estado diretamente dificultaria revisão e rollback.

**Trabalho:** inventariar as alterações, separar commits por domínio,
reconciliar os históricos em branch de integração, revisar o diff e exigir CI
verde antes de promover a release.

**Concluído quando:** nenhuma alteração relevante estiver solta, o histórico
estiver reconciliado sem perda e uma branch/tag apontar exatamente para o
artefato homologado.

### 3. Tornar o E2E e a auditoria de usabilidade determinísticos — P0

**Por quê:** o CI cobre testes unitários, tipos, lint, migrations e rotas
públicas, mas não possui Playwright/Cypress. As 25 telas autenticadas podem
ficar aguardando Supabase ou Redis no ambiente local, impedindo uma repetição
confiável da matriz de 75 cenários.

**Trabalho:** criar fixtures de workspace/usuário, respostas controladas para
serviços externos, timeout por rota e testes E2E dos caminhos críticos:
login, Inbox, criar/editar/mover lead, pipeline, calendário, salvar IA e
configurar OCI/CAPI.

**Concluído quando:** a suíte autenticada roda do zero no CI, termina dentro de
tempo fixo e gera evidências por viewport sem aceitar uma tela de carregamento
como sucesso funcional.

### 4. Atualizar backup e ensaiar restauração — P0

**Por quê:** o backup de 02/09 é íntegro, mas antecede OCI/CAPI, o refino de
usabilidade e o CRM atual. Ele protege a versão anterior, não o próximo
release candidate.

**Trabalho:** após reconciliar o Git, criar archive do worktree, bundle do
histórico e snapshot operacional; cifrar material sensível; recalcular SHA-256;
restaurar em diretório e banco isolados.

**Concluído quando:** código, histórico, banco e arquivos restaurarem com hashes
válidos, tempo de recuperação medido e procedimento documentado.

### 5. Homologar e publicar o pacote local por etapas — P0

**Por quê:** CRM refinado, OCI/CAPI e melhorias de UX existem localmente, mas a
release ativa ainda não contém todo esse pacote. Misturar tudo em um deploy sem
gates amplia o raio de falha.

**Trabalho:** gerar release imutável, aplicar migrations em staging, executar
smoke autenticado com contas sandbox, publicar com janela controlada e validar
readiness, workers, filas, IA, Meta, Google, n8n e conversões.

**Concluído quando:** produção apontar para o commit/tag homologado, smoke real
estiver aprovado e a release anterior continuar disponível para rollback.

### 6. Preparar o CRM para volume e operação em massa — P1

**Por quê:** o board busca até 500 leads e 100 contatos para o cliente. Esse
modelo tende a degradar busca, arraste, memória e tempo de carregamento conforme
a carteira cresce.

**Trabalho:** paginação e busca no servidor, carregamento por coluna,
virtualização para listas extensas, seleção em massa, mudança coletiva de etapa
ou responsável, importação/exportação CSV e upload real de anexos para storage.

**Concluído quando:** um workspace com pelo menos 10 mil leads mantém interação
responsiva, nenhuma consulta depende de carregar a carteira inteira e ações em
massa possuem confirmação, progresso e auditoria.

### 7. Modularizar as telas e consolidar o design system — P1

**Por quê:** `styles.css` tem 11.326 linhas; CRM, Sequências, Contatos e
Calendário possuem entre 2.231 e 2.898 linhas cada. O tamanho aumenta risco de
regressão visual, conflito e revisão lenta.

**Trabalho:** extrair módulos por domínio, hooks e contratos de apresentação;
criar tokens semânticos; unificar drawer, modal, feedback, formulário e estado
vazio; carregar painéis pesados sob demanda.

**Concluído quando:** nenhuma tela principal concentrar regra, transporte e
apresentação no mesmo arquivo, componentes compartilhados tiverem testes e os
budgets de bundle/estilo estiverem automatizados.

### 8. Garantir atomicidade nas operações compostas do CRM — P1

**Por quê:** criação e atualização de lead combinam múltiplas escritas — lead,
score, risco, atividade e auditoria. `Promise.all` e chamadas sequenciais não
substituem uma transação e podem produzir estado parcial.

**Trabalho:** mover comandos compostos para funções transacionais/RPC no banco,
usar versão otimista de forma uniforme, emitir eventos por outbox e cobrir
concorrência entre dois operadores.

**Concluído quando:** cada comando for tudo-ou-nada, conflito retornar mensagem
recuperável ao usuário e testes provarem ausência de lead parcialmente salvo.

### 9. Completar observabilidade, alertas e SLOs — P1

**Por quê:** o sistema já registra auditoria, tentativas e replay, mas os próprios
documentos operacionais ainda marcam alertas externos e dashboards como
pendentes. Falhas podem ser visíveis apenas quando alguém abre o painel.

**Trabalho:** propagar correlation ID, medir latência/erro/idade de fila por
workspace sem expor PII, criar alertas para readiness, heartbeat, scheduler,
webhooks, Meta, conversões e orçamento de IA, além de runbooks acionáveis.

**Concluído quando:** SLOs e limiares estiverem definidos, alertas forem testados
e toda ocorrência crítica puder ser rastreada da entrada à entrega final.

### 10. Preservar contexto e reduzir erro humano nas jornadas — P1

**Por quê:** a base já possui bons alvos de toque, foco e feedback, mas filtros,
seleção e trabalho em andamento ainda precisam de uma estratégia uniforme para
navegação, recarga e troca de dispositivo.

**Trabalho:** representar filtros e seleção relevantes na URL, preservar
rascunhos, bloquear saída com alterações não salvas, incluir desfazer em ações
reversíveis, atalhos documentados e regressão automática de contraste, teclado
e leitores de tela.

**Concluído quando:** recarregar ou compartilhar uma URL restaura o contexto,
nenhum formulário perde trabalho silenciosamente e os fluxos críticos passam
por teclado e tecnologia assistiva no CI.

## Sequência recomendada

| Onda                  | Itens       | Resultado esperado                                       |
| --------------------- | ----------- | -------------------------------------------------------- |
| Segurança da entrega  | 1, 2, 3 e 4 | base auditável, reproduzível e recuperável               |
| Publicação controlada | 5           | CRM/UX/OCI-CAPI homologados e publicados com rollback    |
| Escala e arquitetura  | 6, 7 e 8    | CRM rápido, modular e transacional                       |
| Operação humana       | 9 e 10      | falhas detectadas cedo e jornadas que preservam contexto |

## Portão para iniciar o próximo ciclo

O próximo ciclo deve começar pelo item 1. Os itens 2 a 4 podem avançar em
paralelo, mas o item 5 permanece bloqueado até que todos os P0 estejam
concluídos. Funcionalidades P1 não devem aumentar o número de escritas sem
verificação nem entrar na mesma release antes da estabilização.
