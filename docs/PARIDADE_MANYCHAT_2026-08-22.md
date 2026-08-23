# Paridade Wal Chat × ManyChat

Avaliação: 22 de agosto de 2026.

## Conclusão executiva

O Wal Chat possui uma base funcional forte para Instagram e WhatsApp, mas não
tem paridade total com o ManyChat. Declarar equivalência hoje seria incorreto.
O objetivo realista é paridade no recorte **creator BR + Instagram + WhatsApp +
CRM + agenda + IA**, preservando compliance e evitando copiar recursos que
dependem de parceria exclusiva, outro canal ou outro modelo comercial.

## Matriz funcional

| Capacidade                               | Wal Chat                                             | Avaliação                   |
| ---------------------------------------- | ---------------------------------------------------- | --------------------------- |
| OAuth Instagram profissional             | Backend real                                         | equivalente no recorte      |
| WhatsApp Embedded Signup e Cloud API     | Backend real                                         | equivalente no recorte      |
| Webhooks, deduplicação e observabilidade | Backend real                                         | base superior ao MVP        |
| Keyword em DM/comentário/story/WhatsApp  | Real                                                 | compatível                  |
| Comment-to-DM com resposta única         | Real                                                 | compatível                  |
| Story Reply/Mention                      | Ingestão e gatilho                                   | compatível no contrato Meta |
| Inbox e handoff humano                   | Real, sem app móvel próprio                          | parcial                     |
| CRM, tags, notas, score e campos         | Real                                                 | compatível no recorte       |
| Flow Builder DAG                         | Backend versionado; editor ainda parcial             | parcial                     |
| Mensagem, ação, condição, delay e A/B    | Backend real                                         | parcial avançado            |
| User Input tipado                        | Não implementado no DAG                              | ausente                     |
| External Request/Dynamic Block           | n8n cobre integrações; nó visual ainda ausente       | parcial                     |
| IA com base de conhecimento              | Real                                                 | compatível no recorte       |
| Campanha/reengajamento em massa          | Gate e preview; envio não liberado                   | parcial                     |
| WhatsApp templates fora de 24h           | Sync e gateway real                                  | compatível no recorte       |
| Agenda, Google Meet e Tasks              | Real                                                 | diferencial do Wal Chat     |
| Publicação/Insights/Auto-like            | Partes em protótipo                                  | não equivalente             |
| Templates prontos e marketplace          | Não implementado                                     | ausente                     |
| Website widgets                          | Não implementado                                     | ausente                     |
| Messenger, TikTok, Telegram, SMS e email | Fora do escopo atual                                 | ausente                     |
| Follow-to-DM                             | Recurso condicionado à disponibilidade Meta/parceiro | bloqueado externamente      |
| Aplicativo móvel próprio                 | Não implementado                                     | ausente                     |

## O que esta release adiciona

- wizard central para Meta, WhatsApp, Google, IA e n8n;
- conexão n8n por API key com validação real;
- webhooks bidirecionais HMAC SHA-256;
- defesa contra SSRF, replay e duplicidade;
- outbox durável no scheduler;
- eventos automáticos de contato, mensagem, agendamento e automação;
- ações inbound restritas a CRM, tag e automação publicada.

## Próximas prioridades para paridade do recorte

1. Conectar o editor visual ao contrato DAG versionado.
2. Implementar nó **User Input** com validação e persistência tipada.
3. Implementar nó **External Request** com allowlist, timeout e mapeamento de
   resposta — usando o mesmo cofre de credenciais.
4. Adicionar botões, quick replies, mídia e cards por capacidade do canal.
5. Criar biblioteca de templates PT-BR com versionamento e testes.
6. Liberar campanhas somente após E2E com templates WhatsApp e gates Meta.
7. Completar ingestão de Insights e publicação pelos endpoints oficiais.
8. Adicionar SLAs de Inbox, filas por equipe e relatórios de atendimento.

## Dependências externas

Algumas funções não podem ser produzidas apenas em código. App Review, Business
Verification, acesso a produtos Meta, templates aprovados e recursos liberados
por parceiro permanecem gates externos. O ManyChat anunciou, por exemplo,
**Follow to DM** como recurso inicialmente exclusivo; o Wal Chat só deve
oferecê-lo quando a API e a permissão forem oficialmente disponibilizadas à
aplicação.

Fontes oficiais consultadas:

- [Instagram Automation Features](https://manychat.com/blog/key-instagram-automation-features/)
- [Canais suportados pelo ManyChat](https://help.manychat.com/hc/en-us/categories/13556929063068-Channels)
- [Formato Dynamic Block v2](https://help.manychat.com/hc/en-us/articles/26673580447900-Response-Reference-for-Instagram-WhatsApp-and-Telegram-Automation)
- [Follow to DM](https://community.manychat.com/product-updates/turn-every-follow-into-a-conversation-introducing-follow-to-dm-7628)
