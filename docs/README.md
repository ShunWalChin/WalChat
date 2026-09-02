# Central de documentação do Wal Chat

Este diretório é a fonte de verdade técnica e operacional do Wal Chat. Comece
pela [documentação completa do sistema](DOCUMENTACAO_COMPLETA_DO_SISTEMA.md) e
use os documentos especializados abaixo quando precisar aprofundar uma área.

Última revisão do índice: **02/09/2026**.

## Visão geral

| Documento                                                           | Conteúdo                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Documentação completa](DOCUMENTACAO_COMPLETA_DO_SISTEMA.md)        | Estado atual, arquitetura, módulos, APIs, dados, segurança, operação, deploy, backup e limitações |
| [Arquitetura](ARQUITETURA.md)                                       | Limites dos componentes, dependências e fluxos de falha                                           |
| [Mapa do código](MAPA_DO_CODIGO.md)                                 | Inventário da estrutura do repositório                                                            |
| [Banco de dados](BANCO_DE_DADOS.md)                                 | Tabelas, RLS, funções, índices e migrations                                                       |
| [Guia de desenvolvimento](GUIA_DE_DESENVOLVIMENTO.md)               | Ambiente local, convenções e validações                                                           |
| [Manual completo](MANUAL_COMPLETO_ACESSOS_OPERACAO_CONFIGURACAO.md) | Acessos, configuração e operação pela interface                                                   |

## Produto e automação

| Documento                                                           | Conteúdo                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| [Automation Studio v2](AUTOMATION_STUDIO_V2_2026-08-24.md)          | Editor visual, publicação, execução, simulação e limites     |
| [Arquitetura DAG](ARQUITETURA_BACKEND_AUTOMACOES_DAG_2026-08-22.md) | Motor versionado, scheduler e idempotência                   |
| [Lógica de Sequências](LOGICA_DE_NEGOCIO_SEQUENCIAS.md)             | Regras funcionais, jornadas e nós                            |
| [Paridade ManyChat](PARIDADE_MANYCHAT_2026-08-25.md)                | Cobertura funcional e diferenças deliberadas                 |
| [Integração Deskcomm](INTEGRACAO_DESKCOMM_2026-08-28.md)            | CRM, radar, equipe, respostas, governança e webhooks de lead |
| [Agenda Google](AGENDA_GOOGLE_2026-08-30.md)                        | Agenda operacional, Inbox e Google Workspace                 |

## Integrações e APIs

| Documento                                                            | Conteúdo                                        |
| -------------------------------------------------------------------- | ----------------------------------------------- |
| [API e webhooks](API_E_WEBHOOKS.md)                                  | Contratos HTTP e exemplos de integração         |
| [Meta, Instagram e WhatsApp](INTEGRACOES_META_INSTAGRAM_WHATSAPP.md) | OAuth, webhooks, Cloud API e Embedded Signup    |
| [Meta e OpenAI](CONFIGURACAO_META_E_OPENAI.md)                       | Variáveis e configuração dos provedores         |
| [Google Calendar](CONFIGURACAO_GOOGLE_CALENDAR.md)                   | OAuth PKCE, Calendar, Tasks, Meet e Free/Busy   |
| [Integração n8n](INTEGRACAO_N8N.md)                                  | Ponte bidirecional, autenticação e idempotência |
| [Workflows n8n](WORKFLOWS_N8N_OPERACIONAIS_2026-08-24.md)            | Suíte operacional provisionada                  |

## Segurança, produção e recuperação

| Documento                                                      | Conteúdo                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| [Segurança e compliance](SEGURANCA_E_COMPLIANCE.md)            | Meta, LGPD, opt-out, janela de 24h e controles técnicos     |
| [Auditoria de segurança](AUDITORIA_SEGURANCA_2026-08-25.md)    | Hardening e riscos remanescentes                            |
| [Plano de produção](PLANO_DE_PRODUCAO.md)                      | Critérios de go-live e preparação do ambiente               |
| [Ativação live e backup](ATIVACAO_LIVE_E_BACKUP_2026-08-24.md) | Gates, backup e rollback                                    |
| [Runbook de deploy](DEPLOY_2026-08-25_MANYCHAT_E_SEGURANCA.md) | Publicação por release imutável                             |
| [Release CRM/IA](REGISTRO_RELEASE_20260828_CRM_IA.md)          | Evidências do deploy que incorporou as capacidades Deskcomm |
| [Validação de produção](VALIDACAO_PRODUCAO_REAL_V1.md)         | Matriz de homologação e evidências operacionais             |
| [Débito técnico](DEBITO_TECNICO_2026-08-25.md)                 | Pendências conhecidas e prioridades                         |

## Regra de atualização

Toda mudança de comportamento deve atualizar, no mesmo pull request ou commit:

1. o documento especializado da área;
2. a seção correspondente da documentação completa;
3. o `README.md` da raiz, quando alterar o estado do produto;
4. o registro da release, quando houver publicação em produção.

Segredos nunca entram na documentação. Registre somente nomes de variáveis,
status, hashes, versões e procedimentos de rotação.
