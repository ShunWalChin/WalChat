# Paridade Wal Chat × ManyChat — 25/08/2026

Substitui a avaliação de 22/08, que ficou desatualizada com o Automation Studio
v2 e com esta release.

## Conclusão executiva

No recorte **creator brasileiro em Instagram e WhatsApp**, o Wal Chat agora tem
o essencial do ManyChat: conversa com botões, coleta de dados validada, chamada
a sistemas externos, teste antes de publicar e modelos prontos. Fora desse
recorte — outros canais, app móvel, marketplace de templates — não há paridade,
e declarar que há continuaria sendo incorreto.

## O que mudou nesta release

Antes desta entrega faltava a base de qualquer bot conversacional, e a falta era
estrutural, não cosmética:

- **Não existiam botões.** O sender de Instagram mandava só `{text}` ou
  `{attachment}`; o de WhatsApp não tinha mensagem interativa nenhuma.
- **O motor nunca esperava o contato.** Ele retomava depois que a mensagem
  **saía**, não depois que a pessoa **respondia**. Não havia estado de espera por
  mensagem recebida.
- **Não havia como perguntar e guardar.** Nenhum nó coletava, validava e
  persistia uma resposta.

Consequência prática: todo fluxo dependia de o contato digitar texto livre e um
nó de condição tentar adivinhar. Um detalhe revelador do estado anterior: a
ingestão **já lia postback** (`event.postback.payload`, canal `postback`
registrado). Alguém preparou o lado de receber botão — mas como nada nunca
enviava um botão, esse caminho era código morto.

O que entrou:

| Capacidade                 | Como ficou                                                             |
| -------------------------- | ---------------------------------------------------------------------- |
| Botões e respostas rápidas | Uma lista única de escolhas no bloco; o canal escolhe a forma nativa   |
| Espera por resposta        | Estado `waiting_reply` próprio, com prazo e saída de timeout           |
| Coleta de dados            | Nó de pergunta com validação de e-mail, telefone, número, data e texto |
| Chamada a sistema externo  | Nó com allowlist, timeout e mapeamento da resposta para campos         |
| Teste antes de publicar    | Simulador que percorre o fluxo sem enviar nem chamar nada              |
| Ponto de partida           | Quatro jornadas prontas em PT-BR, publicáveis como estão               |

### Um contrato, dois canais

O operador escreve uma lista de escolhas e só isso. A tradução acontece no
envio: quick reply no Instagram; no WhatsApp, botão até três opções e lista a
partir da quarta, que é exatamente o critério da Cloud API. Obrigar quem monta
um fluxo a conhecer o limite de cada API seria transferir a ele um problema que
é do produto.

O contato que **digita** o texto do botão em vez de tocar nele também é
entendido — isso acontece o tempo todo e travaria a conversa.

## Matriz funcional

| Capacidade                               | Wal Chat                               | Avaliação                |
| ---------------------------------------- | -------------------------------------- | ------------------------ |
| OAuth Instagram profissional             | Backend real                           | equivalente no recorte   |
| WhatsApp Embedded Signup e Cloud API     | Backend real                           | equivalente no recorte   |
| Webhooks, deduplicação e observabilidade | Backend real                           | base superior            |
| Keyword em DM/comentário/story/WhatsApp  | Real                                   | compatível               |
| Comment-to-DM com resposta única         | Real                                   | compatível               |
| **Botões e quick replies**               | **Real nos dois canais**               | **compatível**           |
| **Espera por resposta e ramificação**    | **Real, com prazo e timeout**          | **compatível**           |
| **User Input tipado**                    | **Real, com tentativas e destino**     | **compatível**           |
| **External Request com resposta**        | **Real, com allowlist e mapeamento**   | **compatível**           |
| **Teste do fluxo sem publicar**          | **Real, sem efeito externo**           | **compatível**           |
| **Templates prontos**                    | **Quatro em PT-BR**                    | parcial: sem marketplace |
| Flow Builder DAG                         | Editor visual ligado ao DAG versionado | compatível no recorte    |
| Mensagem, ação, condição, delay e A/B    | Real                                   | compatível               |
| Inbox e handoff humano                   | Real, sem app móvel próprio            | parcial                  |
| CRM, tags, notas, score e campos         | Real                                   | compatível no recorte    |
| IA com base de conhecimento              | Real                                   | compatível no recorte    |
| Campanha/reengajamento em massa          | Gate e preview; envio não liberado     | parcial                  |
| WhatsApp templates fora de 24h           | Sync e gateway real                    | compatível no recorte    |
| Agenda, Google Meet e Tasks              | Real                                   | diferencial do Wal Chat  |
| Publicação e Insights                    | Backend real; alcance depende do ativo | parcial                  |
| Growth tools: link, QR code, widget      | Não implementado                       | ausente                  |
| Marketplace de templates                 | Não implementado                       | ausente                  |
| Messenger, TikTok, Telegram, SMS e email | Fora do escopo atual                   | ausente                  |
| Follow-to-DM                             | Depende de liberação Meta/parceiro     | bloqueado externamente   |
| Aplicativo móvel próprio                 | Não implementado                       | ausente                  |

## O que ainda falta, em ordem de peso

1. **Growth tools.** Link `ig.me`/`m.me` com referência, QR code e widget de
   site. É como o ManyChat leva gente para dentro do fluxo, e hoje o Wal Chat
   depende só de comentário e palavra-chave.
2. **Liberar campanhas.** O envio em massa tem preview e gate, mas continua
   travado até um E2E com templates aprovados.
3. **Relatórios de atendimento.** SLA de Inbox, fila por equipe e produtividade.
4. **Marketplace de templates.** Os quatro modelos cobrem o começo; compartilhar
   e importar jornadas é outra coisa.
5. **App móvel.** Fora de alcance sem uma decisão de produto própria.

## Decisões de segurança que a paridade não pode custar

Três escolhas foram feitas contra a conveniência, de propósito:

- **Resposta que não casa com nenhum botão não avança o fluxo e não é engolida.**
  Ela segue para a Inbox, gatilhos e IA. Um menu que sequestra tudo que o contato
  escreve é pior que menu nenhum.
- **O payload do botão carrega o nó, mas o roteamento não confia nele.** Quem
  decide o nó é a execução em espera no banco. O payload volta do cliente e
  cliente é dado externo.
- **O destino do bloco de requisição externa é validado a cada execução**, não só
  na publicação, porque a URL aceita variáveis do contato e o host final só
  existe na hora de chamar. Redirect é recusado: segui-lo escaparia da validação.

## Verificação

238 testes automatizados, 39 arquivos. Os 118 acrescentados nesta release cobrem
o contrato dos nós novos, a renderização por canal, o casamento da resposta, a
validação das respostas coletadas, a proteção do bloco externo, o simulador e a
validade de cada template.

Fontes oficiais consultadas na avaliação anterior seguem valendo:

- [Instagram Automation Features](https://manychat.com/blog/key-instagram-automation-features/)
- [Canais suportados pelo ManyChat](https://help.manychat.com/hc/en-us/categories/13556929063068-Channels)
- [Follow to DM](https://community.manychat.com/product-updates/turn-every-follow-into-a-conversation-introducing-follow-to-dm-7628)
