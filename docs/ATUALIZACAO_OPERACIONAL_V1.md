# Atualização operacional V1

Esta entrega transforma os fluxos críticos do Wal Chat em uma operação controlável por workspace. Ela não remove a necessidade de App Review, credenciais reais ou validação com uma conta Professional da Meta: esses itens externos continuam sendo gates explícitos.

## Escopo entregue

| Prioridade | Entrega                      | Interface             | Backend                                               |
| ---------- | ---------------------------- | --------------------- | ----------------------------------------------------- |
| 1          | Central de Go-Live           | `/operacoes`          | diagnóstico e kill switches por workspace             |
| 2          | Assistente Meta              | `/configuracoes`      | OAuth, status, validação e sincronização de mídia     |
| 3          | Gateway único de disparos    | todas as saídas       | trava de Go-Live + compliance + claim idempotente     |
| 4          | Observabilidade dos webhooks | `/operacoes`          | contadores, latência, erro e replay restrito          |
| 5          | Inbox operacional            | `/inbox`              | atribuição, prioridade, status e notas internas       |
| 6          | Comment-to-DM real           | `/comment-to-dm`      | post real, gatilho, cooldown e Private Reply único    |
| 7          | Copiloto com conhecimento    | `/agentes` e `/inbox` | busca textual isolada por tenant e fontes na sugestão |

## Arquitetura de segurança dos disparos

Todo efeito externo passa por uma única fronteira no servidor:

```text
origem -> gateway Meta -> trava do workspace -> compliance no instante do envio
       -> claim idempotente -> Graph API -> auditoria persistente
```

As três chaves operacionais são armazenadas em `workspace_runtime_settings`:

- `external_sends_enabled`: kill switch principal;
- `comment_to_dm_enabled`: autoriza respostas privadas de comentário;
- `autonomous_ai_enabled`: autoriza o agente autônomo a agendar respostas.

Desligar os disparos externos desliga automaticamente Comment-to-DM e IA autônoma. O modo `DEMO_MODE=true` continua sem efeitos externos e serve para homologação da interface e das regras.

Para ligar a chave principal, um `owner` ou `admin` precisa zerar todos os bloqueios críticos e digitar exatamente `ATIVAR PRODUCAO`. A mudança é registrada em `integration_audit_logs`.

## Central de Go-Live

O diagnóstico verifica, sem devolver secrets:

- aplicação fora do modo demo e com origem HTTPS;
- conectividade com Supabase e Redis;
- chave de cifra configurada;
- App ID e secret da Meta;
- conta Instagram conectada e token cifrado válido;
- permissões e campos de webhook esperados;
- ausência de entregas externas com estado `unknown`;
- provedor de IA pronto;
- eventos de webhook com falha.

Falhas críticas impedem a ativação. Avisos não impedem a chave principal, mas devem ser resolvidos antes de aumentar tráfego.

## Assistente Meta e Comment-to-DM

O assistente de configuração apresenta cinco etapas: requisitos da conta, credenciais, OAuth, webhook e validação. O token nunca é exposto ao navegador.

O editor de Comment-to-DM sincroniza até 50 publicações reais da conta conectada. Cada regra vincula explicitamente um `instagram_media_id`, palavra-chave, modo de comparação, texto de resposta e cooldown. No processamento:

1. o worker confirma o post e a palavra;
2. cria um `automation_run` auditável;
3. o scheduler relê o estado atual;
4. o gateway exige a chave de Comment-to-DM em live;
5. aplica janela de Private Reply, blocklist e cooldown;
6. grava o claim por ID do comentário antes de chamar a Meta;
7. uma resposta ambígua não é repetida automaticamente.

Blocos de typing/delay preservam o contexto do comentário até o primeiro bloco de mensagem. Depois da primeira Private Reply, a automação é concluída para impedir uma segunda resposta automática no mesmo comentário.

## Observabilidade de webhooks

`/operacoes` mostra eventos por status, horário de recebimento, tipo, tentativas, duração e último erro. O payload bruto não é devolvido pela API operacional.

Somente `owner/admin` pode reenfileirar um evento, e apenas quando seu status é `failed`. O replay recebe um novo job técnico, conserva a chave idempotente do evento e gera auditoria. Eventos processados não podem ser reenviados por esse endpoint.

## Inbox operacional

A Inbox agora permite:

- atribuir ou assumir uma conversa;
- definir prioridade baixa, normal, alta ou urgente;
- mover entre aberta, pendente e resolvida;
- registrar notas internas separadas das mensagens do Instagram;
- identificar o responsável e o prazo restante da janela de 24 horas;
- pedir uma sugestão do copiloto e ver as fontes utilizadas.

Conversas resolvidas não aceitam novo envio até serem reabertas. Notas nunca são enviadas à Meta.

## Copiloto com base de conhecimento

Os documentos aceitam texto, URL de origem ou referência de arquivo. O conteúdo fica no Postgres do tenant, com checksum e RLS. Na sugestão:

1. a última mensagem do cliente gera a consulta;
2. `search_knowledge_documents` ranqueia documentos com full-text search em português;
3. somente os cinco trechos mais relevantes entram no prompt;
4. o provedor recebe os IDs das fontes, não credenciais;
5. a resposta volta com fontes para conferência do atendente.

O OpenAI usa Responses API com `store: false` e `safety_identifier` derivado por hash. O playground e o modo copiloto não disparam mensagens. A autonomia exige chave separada na Central de Go-Live e ainda passa pelo mesmo gateway de compliance.

## Objetos de banco adicionados

A migration `20260820120000_operational_go_live.sql` adiciona:

- `workspace_runtime_settings`;
- `conversation_notes`;
- `automation_runs`;
- campos operacionais em `conversations`, `webhook_events`, `comment_private_replies` e `knowledge_documents`;
- índices para fila, Inbox e busca;
- função `search_knowledge_documents` restrita à service role;
- RLS e GRANTs compatíveis com os papéis do workspace.

A migration é aditiva. O rollback operacional prioritário é desligar `external_sends_enabled`; não remova tabelas durante um incidente.

## APIs adicionadas ou ampliadas

| Método                  | Rota                           | Uso                                     |
| ----------------------- | ------------------------------ | --------------------------------------- |
| `GET/PATCH`             | `/api/operations/go-live`      | diagnóstico e controles de runtime      |
| `GET/POST`              | `/api/operations/webhooks`     | eventos sanitizados e replay de falha   |
| `GET/POST`              | `/api/integrations/meta/media` | lista cache e sincroniza posts reais    |
| `GET/PATCH`             | `/api/inbox`                   | consulta e opera conversas              |
| `POST/DELETE`           | `/api/inbox`                   | cria/remove nota interna                |
| `GET/POST/PATCH/DELETE` | `/api/ai/knowledge`            | base com origem, checksum e status      |
| `POST`                  | `/api/ai/suggest`              | sugestão com fontes recuperadas         |
| `GET/POST/PATCH/DELETE` | `/api/triggers`                | gatilho por post e métricas de execução |

## Sequência de implantação

1. Gerar backup verificado do Postgres e registrar a versão atual da imagem.
2. Confirmar `DEMO_MODE=true` e manter os switches de todos os workspaces desligados.
3. Aplicar a migration aditiva.
4. Publicar app, worker de webhook e scheduler da mesma revisão.
5. Executar health, readiness, rotas e smoke integrado.
6. Configurar secrets reais somente no backend.
7. Conectar a conta de teste pelo OAuth e concluir a validação Meta.
8. Testar webhook e IA ainda em modo demo.
9. Alterar `DEMO_MODE=false`, reiniciar a stack e repetir readiness.
10. Na Central de Go-Live, ativar primeiro disparos externos, depois Comment-to-DM e, por último, IA autônoma.
11. Fazer o piloto com uma conta e palavras controladas; acompanhar webhooks e entregas `unknown`.

Se qualquer evidência divergir, desligue a chave principal do workspace. Esse kill switch é a primeira ação do rollback.

## Matriz mínima de aceite real

- DM inbound cria contato, conversa e mensagem uma única vez;
- DM manual dentro de 24h chega e aparece como `sent`;
- opt-out `PARAR` bloqueia o próximo envio;
- comentario no post correto gera uma única Private Reply;
- replay do webhook não duplica conversa, automação ou resposta;
- cooldown bloqueia a segunda tentativa do mesmo gatilho;
- timeout externo produz `unknown` e exige conciliação humana;
- sugestão do copiloto informa ao menos uma fonte quando há documento relevante;
- agente copiloto nunca envia sozinho;
- desligar a chave principal interrompe todas as novas saídas.

Os testes automáticos provam contratos internos. Entrega na Meta, App Review e faturamento da OpenAI só podem ser aprovados depois dos testes externos acima.
