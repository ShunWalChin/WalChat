# Integração funcional DeskcommCRM → Wal Chat

Data da análise: 28/08/2026  
Fonte: `melgarafael/DeskcommCRM`  
Revisão estudada: `8b868bf3e4a24256385f683bce3a9534b62150f9`

## Decisão de arquitetura

O DeskcommCRM não foi embarcado como uma segunda aplicação Next.js. Seus conceitos reaproveitáveis foram reimplementados no núcleo do Wal Chat em TanStack Start, React 19, Supabase, Redis e BullMQ. Isso mantém uma única autenticação, um único workspace ativo, as políticas RLS, a criptografia de credenciais, o motor de compliance e o gateway de entrega já existentes.

O código de referência tem licença MIT. O aviso exigido está preservado em `THIRD_PARTY_NOTICES.md`.

## Inventário e destino

| Capacidade observada no DeskcommCRM       | Base anterior do Wal Chat                  | Resultado integrado                                                                                                                          |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline/Kanban comercial                 | Contatos com estágio e score               | Pipeline multi-board, etapas configuráveis, drag-and-drop, valor, responsável, motivo de perda, próxima ação e concorrência otimista         |
| Radar de oportunidades paradas            | Métricas e score de contato                | Classificação determinística hot/warm/cold, materialização de mudança de faixa e reconciliação a cada 5 minutos                              |
| Distribuição e disponibilidade da equipe  | Atribuição de conversas                    | Disponibilidade, capacidade, horário comercial e estratégias round-robin, menor carga ou manual                                              |
| Respostas rápidas                         | Mensagens humanas e templates WhatsApp     | Biblioteca pessoal/compartilhada com atalhos, categorias e permissões                                                                        |
| Webhooks de captação                      | Webhooks assinados Meta/n8n                | Fontes isoladas por token, token armazenado somente como SHA-256, limite de corpo, rate limit, sanitização e criação de contato/lead         |
| Orçamento e observabilidade de IA         | OpenAI/Gemini por workspace                | Limite mensal de tokens, alerta, hard stop, log de tokens, latência, modelo, finalidade e falhas                                             |
| Versões de agentes                        | Agentes persistidos e base de conhecimento | Snapshots imutáveis e resumo de mudança por agente                                                                                           |
| Roteamento de múltiplos agentes           | Agente selecionável                        | Roteadores por intenção/prioridade/fallback e membros versionáveis no banco                                                                  |
| Memória organizacional                    | Documentos por agente                      | Memórias curtas, nomeadas, auditáveis e ativáveis por workspace                                                                              |
| Casos e handoff humano                    | Ação de handoff no DAG                     | Caixa de casos, prioridade, responsável, eventos e estados de resolução                                                                      |
| Auditoria administrativa                  | Auditorias de contato e integração         | Trilha unificada de mutações CRM/IA/equipe/webhook e eventos de integração                                                                   |
| Regras e automações                       | Automation Studio v2                       | Mantido o DAG nativo do Wal Chat; novas tabelas de regras permitem evolução sem duplicar o motor atual                                       |
| WhatsApp                                  | WhatsApp Cloud API oficial                 | Mantida a Cloud API oficial. WAHA não foi copiado porque duplicaria o canal e reduziria as garantias de compliance existentes                |
| Instagram, agenda, Google, n8n, conteúdo  | Já implementados                           | Mantidos e conectados pelo mesmo workspace; não houve regressão para adaptadores paralelos                                                   |
| Nuvemshop e canais comerciais específicos | Não existiam                               | Não ativados sem credenciais, contrato de API e decisão de produto; a captação genérica por webhook cobre a entrada de leads de forma segura |

## Superfícies entregues

- `/crm`: quadro comercial e movimentação de oportunidades.
- `/radar`: risco por inatividade e próxima ação.
- `/equipe`: disponibilidade, capacidade e roteamento.
- `/respostas`: biblioteca de respostas rápidas.
- `/governanca`: orçamento, memória, roteadores, versões, casos e execuções de IA.
- `/webhooks`: criação de fontes e observação de capturas.
- `/auditoria`: trilha operacional e de integrações.

## Dados e segurança

A migration `20260828090000_deskcomm_capabilities_core.sql` é aditiva. Ela cria o domínio comercial e de governança sem remover tabelas atuais, aplica `workspace_id` em todas as entidades, habilita RLS, cria índices de leitura operacional e instala pipeline padrão para workspaces novos e existentes.

Decisões de segurança relevantes:

- credenciais do provedor de IA continuam cifradas no servidor;
- tokens de captação são retornados uma única vez e apenas seu hash é persistido;
- o webhook público limita o corpo e aplica rate limit antes de mutar o CRM;
- dados sensíveis comuns do payload são removidos antes da retenção;
- mutações verificam origem e papel do membro;
- movimentação de lead usa `lock_version` para detectar edição concorrente;
- logs de IA não persistem prompt ou resposta;
- cada mudança administrativa relevante gera auditoria.

## Limites conscientes

“Copiar todo o sistema” foi interpretado como portar tudo que é tecnicamente compatível e útil ao Wal Chat, não reproduzir bugs, dependências duplicadas ou integrações para as quais não há autorização/credencial. Provedores específicos ainda podem ser adicionados como adaptadores do gateway existente, sem criar uma segunda fonte de verdade.
