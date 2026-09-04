# Auditoria e refino de usabilidade do Wal Chat

Data da revisão: 03/09/2026

## Objetivo

Validar o produto pelo ponto de vista de quem atende clientes, organiza o CRM,
configura automações e integra canais todos os dias. A revisão priorizou clareza
do próximo passo, prevenção de erro, operação por toque, navegação por teclado,
leitura em telas pequenas e redução da carga cognitiva em configurações técnicas.

## Perfis e jornadas consideradas

- **Atendente:** abrir o Inbox, localizar uma conversa, entender janela de envio,
  responder, registrar nota e atualizar contexto sem perder a conversa atual.
- **Comercial:** acompanhar pipeline, risco e contatos; filtrar, criar, editar e
  mover oportunidades com retorno visual imediato.
- **Marketing:** criar captação, gatilhos, sequências, campanhas e conteúdo;
  revisar antes de ativar ou publicar.
- **Administrador:** conectar Meta, Google, IA, n8n e OCI/CAPI; salvar segredo,
  testar, diagnosticar e desconectar com confirmação.
- **Gestor:** ler visão geral, calendário, insights, operação, auditoria e saúde
  das integrações sem depender de conhecimento técnico.

## Matriz de telas e fluxo validado

| Tela              | Objetivo humano                                | Fluxo principal verificado                                                      |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Visão geral       | Entender a operação em segundos                | Ler indicadores, pendências e atalhos; título não depende mais de uma data fixa |
| Operação          | Decidir se o workspace pode entrar em produção | Ler prontidão, validar bloqueios, testar e liberar controles conscientes        |
| Inbox             | Atender sem trocar de contexto                 | Filtrar, buscar, selecionar conversa, ler janela, responder e consultar contato |
| Pipeline CRM      | Trabalhar oportunidades                        | Filtrar, criar, abrir, editar e mover lead entre etapas                         |
| Radar comercial   | Priorizar risco                                | Identificar oportunidade parada e abrir o contexto correspondente               |
| Contatos & tags   | Organizar relacionamento                       | Buscar, filtrar, criar contato, aplicar tags, editar e auditar notas            |
| Respostas rápidas | Padronizar atendimento                         | Criar, localizar, editar e remover modelo com confirmação                       |
| Equipe            | Distribuir trabalho                            | Consultar capacidade, papéis e estratégia de roteamento                         |
| Gatilhos          | Automatizar entrada                            | Filtrar origem, configurar condição/destino, revisar compliance e ativar        |
| Boas-vindas       | Recepcionar novos contatos                     | Definir mensagem, limites, estado e salvar com retorno                          |
| Captação          | Gerar links rastreáveis                        | Informar origem, criar, copiar, ativar e identificar atribuição                 |
| Comment-to-DM     | Responder comentários com segurança            | Escolher post/termo, resposta, cooldown, pré-visualizar e ativar                |
| Sequências        | Construir jornada                              | Buscar/criar fluxo, editar blocos, simular, versionar, publicar e executar      |
| Agentes de IA     | Configurar assistência                         | Definir agente, base, modelo e testar antes de habilitar                        |
| Governança de IA  | Controlar comportamento                        | Inspecionar memória, ferramentas, políticas e trilha de execução                |
| Reengajamento     | Retomar contatos elegíveis                     | Escolher público, conteúdo, ritmo, prévia e agendamento protegido               |
| Auto-like         | Configurar engajamento                         | Definir critérios, limites e estado sem esconder restrições                     |
| Calendário        | Planejar e agir                                | Navegar período, alternar visão, criar/editar item e configurar Google          |
| Publicar          | Produzir conteúdo revisável                    | Escolher formato, elaborar, usar IA, salvar, agendar e publicar                 |
| Insights          | Ler e exportar desempenho                      | Escolher conta, sincronizar, analisar e exportar relatório                      |
| Configurações     | Preparar conta e canais                        | Seguir wizard Meta, copiar callbacks, configurar WhatsApp/IA e salvar           |
| Integrações       | Conectar serviços                              | Escolher provedor, preencher, salvar, testar, diagnosticar e desconectar        |
| Webhooks de leads | Receber captação externa                       | Copiar endpoint, revisar contrato, validar recebimento e erros                  |
| Auditoria         | Rastrear ação sensível                         | Filtrar eventos e conferir autor, ação, alvo e momento                          |
| Manual            | Encontrar instrução e concluir Go-Live         | Pesquisar capítulo, navegar por sumário, copiar valores e marcar checklist      |

## Melhorias implementadas

### Navegação e orientação

- Atalho “Pular para o conteúdo” disponível por teclado em todas as telas.
- Um único conteúdo principal e um único título de nível 1 por rota.
- Foco movido ao conteúdo após navegação para anunciar a nova tela.
- Menu mobile abre com foco no botão de fechar, responde a `Esc`, bloqueia a
  rolagem do fundo, mantém a navegação recolhida fora da ordem de tabulação e
  devolve o foco ao acionador.
- A ação global agora se chama “Criar conteúdo”, igual ao destino real.
- Estado da conexão Meta é recarregado quando o workspace muda.

### Operação por toque e responsividade

- Controles de ação, filtros, navegação, calendário, campos e switches usam área
  interativa mínima de 44 × 44 px, mantendo o desenho visual compacto.
- Ações de página quebram linha no celular em vez de sair da tela.
- Configurações e Integrações não geram mais rolagem horizontal a 375 px.
- Calendário preserva controles alcançáveis e permite rolagem apenas na grade,
  onde a densidade de dias exige esse comportamento.
- Manual mantém a busca visível no celular e oferece “Voltar ao topo”.

### Formulários, retorno e carga cognitiva

- Campo de origem da Captação recebeu rótulo programático explícito.
- Filtros do Inbox expõem estado pressionado; busca e conversa selecionada têm
  nome/estado acessível.
- Feedback de Configurações e Integrações é anunciado como erro ou status.
- Configuração OCI/CAPI mostra primeiro provedores e regras; snippet e saúde do
  pipeline ficam em uma seção técnica expansível.
- Estrutura inválida de conteúdo principal aninhado em Sequências e Manual foi
  corrigida.
- Animações dos novos componentes respeitam `prefers-reduced-motion`.

## Validação reproduzível

O comando abaixo percorre as 25 rotas autenticadas em 375 × 812, 812 × 375 e
1440 × 900. São 75 combinações verificadas por Chrome/Edge headless.

```powershell
$env:WALCHAT_AUDIT_URL='http://127.0.0.1:3002'
npm run audit:usability
```

Critérios automáticos:

- rota autenticada carregada;
- um `h1`, um `main` e nenhum `main` aninhado;
- atalho para o conteúdo presente;
- ausência de controle sem nome acessível;
- ausência de alvo interativo abaixo de 44 × 44 px (links textuais em parágrafo
  seguem a exceção de conteúdo inline);
- ausência de rolagem horizontal da página;
- abertura, foco, fechamento por `Esc` e retorno de foco no menu mobile.

## Limites da auditoria

A matriz local usa dados de demonstração e não executa ações irreversíveis nem
chamadas reais para Meta, Google, WhatsApp ou n8n. Permissões, tokens expirados,
rate limits e respostas externas devem continuar cobertos pelos smoke tests de
integração e pela homologação com contas sandbox antes do Go-Live.
