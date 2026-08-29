# Lógica de negócio: sequências e jornadas

Referência do que acontece entre um contato falar e o sistema responder.

## O nome engana, e isso é a primeira coisa a saber

A tela **Sequências** (`/sequencias`) **não edita sequências**. Ela é o
Automation Studio e edita `automation_flows` — o DAG versionado.

O modelo de dados chamado `sequences` é outra coisa: uma lista linear de passos,
com API própria em `/api/sequences` e **nenhuma tela**. Só existe por API.

São dois motores de automação convivendo no mesmo produto.

## O gatilho é o roteador

O banco força a escolha:

```sql
check (num_nonnulls(response_text, sequence_id, flow_id) = 1)
```

Exatamente um destino, nunca dois:

| Destino         | O que faz                    | Tem editor? |
| --------------- | ---------------------------- | ----------- |
| `response_text` | Uma mensagem e encerra       | sim         |
| `sequence_id`   | Sequência linear com delays  | **não**     |
| `flow_id`       | Jornada DAG com ramificações | sim         |

### Quando dois gatilhos casam, o mais antigo vence

```js
.eq('is_active', true).order('created_at')
for (const trigger of triggers) { /* primeiro que casa, retorna */ }
```

**Não há desempate por especificidade.** Um gatilho global criado antes vence um
gatilho específico de post criado depois — o específico nunca dispara. Isso é
determinístico, não intermitente: o comportamento é sempre o do mais antigo.

Ao depurar "meu gatilho novo não funciona", procure primeiro um gatilho mais
antigo com a mesma palavra e origem.

### As portas que o gatilho ainda atravessa

Antes de agendar qualquer coisa, na ordem:

1. **Opt-out** — contato que respondeu `PARAR` não entra em automação.
2. **Palavra-chave** — `exact` compara igual, `contains` procura dentro; ambos
   normalizados para caixa baixa em pt-BR.
3. **Post específico** — se o gatilho tem `post_id`, o comentário precisa ser
   daquele post.
4. **Run existente** — se já existe `automation_run` para este gatilho e esta
   interação em estado diferente de `matched`, a decisão já foi tomada e não se
   duplica.
5. **Cooldown** — `cooldown_hours` por gatilho e contato.

## Motor 1: sequência linear

Passos ordenados por `position`, de quatro tipos: `text`, `media`, `typing`,
`delay`. O estado por contato vive em `sequence_enrollments`.

```
envia posição N
      ↓
busca posição N+1
      ├─ existe    → agenda job com run_at = agora + delay_seconds DO PRÓXIMO
      │              e grava current_position = N+1
      └─ não existe → status = 'completed'
```

Três detalhes que definem o comportamento:

**O delay pertence ao passo que vai chegar**, não ao que acabou de sair. É por
isso que `delay` exige no mínimo 60s e `typing` no mínimo 1s: são passos que
existem só para criar pausa antes do próximo.

**Idempotência por chave** `enrollment:{id}:step:{n}` com `ignoreDuplicates`.
Reprocessar o mesmo passo não duplica mensagem.

**Regra da Meta embutida na validação**: um bloco `media` precisa ser seguido
imediatamente por `text`. O rodapé obrigatório `Responda PARAR` viaja no texto —
mídia sozinha sairia sem opt-out.

Estados da inscrição: `active`, `completed`, `paused`, `cancelled`, `blocked`.

## Motor 2: jornada DAG

Grafo validado e **imutável ao publicar** — a execução carrega o
`flow_version_id` e continua na versão em que começou, mesmo que o rascunho mude.

Estados da execução: `scheduled`, `running`, `waiting` (relógio),
`waiting_reply` (contato), `completed`, `blocked`, `failed`, `cancelled`.

Treze tipos de bloco. Os que mudam o fluxo:

| Bloco              | Portas de saída                           |
| ------------------ | ----------------------------------------- |
| `message`          | `default`, ou uma por escolha + `timeout` |
| `user_input`       | `default`, `invalid`, `timeout`           |
| `condition`        | `true`, `false`                           |
| `random_split`     | uma por ramo, pesos somando 100           |
| `external_request` | `default`, `error`                        |

As portas são validadas na publicação: obrigatórias precisam existir, e nenhuma
saída pode apontar para uma porta que o bloco não tem.

### A espera por resposta

Quando um bloco tem escolhas ou é uma pergunta, a execução **só estaciona depois
que a mensagem sai** — parar antes deixaria o fluxo esperando resposta a algo que
o compliance bloqueou.

Enquanto estacionada, uma mensagem do contato tenta casar:

- **casou** → segue pela porta correspondente;
- **não casou** → devolve `handled: false` **de propósito**, e a mensagem segue
  para Inbox, gatilhos e IA. Um menu que engole tudo que o contato escreve é pior
  que menu nenhum.

Numa pergunta, resposta inválida consome uma tentativa e reenvia a orientação.
Esgotadas as tentativas, sai por `invalid`; sem essa porta desenhada, encerra —
melhor que deixar o contato preso repetindo.

O payload do botão carrega o nó por diagnóstico, mas **o roteamento nunca confia
nele**: quem decide o nó é a execução em espera no banco. Payload volta do
cliente, e cliente é dado externo.

## O que os dois motores compartilham

**O compliance roda no momento do envio, não no agendamento.** Um passo agendado
ontem para hoje é reavaliado agora: janela de 24h, `HUMAN_AGENT` de 7 dias,
opt-out, cooldown, blocklist. Um contato que respondeu `PARAR` depois do
agendamento não recebe.

Todo envio também passa por claim at-most-once em `outbound_deliveries`. Resposta
ambígua da Meta vira estado `unknown` e **não** é reenviada às cegas.

## Qual usar

|                 | Sequência linear              | Jornada DAG     |
| --------------- | ----------------------------- | --------------- |
| Forma           | fila de passos                | grafo           |
| Ramifica        | não                           | sim             |
| Espera resposta | não                           | sim             |
| Versionamento   | edição afeta inscritos ativos | versão imutável |
| Editor          | não tem                       | tem             |

A sequência linear é o mecanismo antigo. O DAG faz tudo que ela faz e mais.
Manter os dois custa duas implementações para o mesmo problema — a depreciação
da sequência linear é uma decisão de produto que vale ser tomada.
