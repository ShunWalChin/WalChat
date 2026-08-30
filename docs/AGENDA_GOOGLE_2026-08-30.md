# Agenda Google: como funciona e o que falta ligar

Data: 30/08/2026 · Release `20260830-agenda-ia-v1`

## Em uma frase

A IA agora consulta a agenda de verdade, marca a reunião, cria o link do Meet e
manda o convite para o lead e para você — sem passar por um humano, quando você
autoriza. Falta um passo que só o dono da conta Google pode dar.

---

## O que já existia

O backend do Google estava construído e nunca foi ligado:

- OAuth com PKCE, `state` de uso único guardado com hash, e revalidação do papel
  do usuário no momento do retorno
- Renovação automática do token, com a conexão marcada como `expired` quando o
  refresh falha por autorização
- `freeBusy`, criação e edição de evento, Google Meet, Google Tasks
- Sincronização incremental com `syncToken`, com full sync automático quando o
  Google responde 410

Nada disso precisou ser reescrito.

## O que faltava

Um caminho para alguém além da página pública usar tudo aquilo. A composição que
decide um horário — juntar os compromissos locais com o `freeBusy`, gerar os
livres, reservar em transação, criar o evento com Meet — vivia dentro da rota
HTTP da página pública.

Copiar essa composição para um segundo caminho seria o começo de um agendamento
em cima do outro: basta uma das cópias esquecer o `freeBusy`, ou consultar um
intervalo diferente, para duas pessoas caírem no mesmo horário.

## O que mudou

### Um serviço único

`src/server/booking-service.server.ts` concentra a decisão de agenda. A página
pública virou uma chamadora como qualquer outra — a IA usa exatamente o mesmo
caminho, então ela não consegue oferecer um horário que a página já vendeu.

A garantia forte continua sendo do banco. `reserve_calendar_booking` pega um lock
consultivo pela agenda e revalida a sobreposição dentro da transação. A checagem
do serviço serve para escolher e para responder bem; a do banco é a que decide.

### Ferramentas para a IA

| Ferramenta                    | O que faz                                       |
| ----------------------------- | ----------------------------------------------- |
| `consultar_horarios`          | Lista os horários realmente livres              |
| `agendar_reuniao`             | Reserva, cria o evento e o Meet, convida o lead |
| `consultar_meus_agendamentos` | Mostra a próxima reunião daquela pessoa         |
| `remarcar_reuniao`            | Move a próxima reunião                          |
| `cancelar_reuniao`            | Cancela e libera o horário                      |

Duas decisões sustentam a segurança:

**O modelo escolhe o quê, nunca de quem.** Nenhuma ferramenta aceita
identificador de contato, de workspace ou de agendamento. Esses valores vêm da
conversa e são aplicados por cima dos argumentos. Não existe frase que o lead
possa escrever para fazer a IA mexer na agenda de outra pessoa — o modelo não tem
onde colocar o alvo. Um teste trava essa invariante.

**Copiloto não executa.** No modo copiloto a IA escreve um rascunho para revisão.
Se pudesse chamar `agendar_reuniao`, a reunião entraria na agenda no instante em
que o rascunho fosse gerado, mesmo que o operador o descartasse. O copiloto
recebe só as ferramentas de leitura; marcar, remarcar e cancelar são do modo
autônomo, onde a resposta já é a ação.

### Quando as ferramentas ligam

Só quando você vincula uma agenda ao agente de IA. Ligá-las por existir uma
agenda no workspace faria uma IA começar a marcar reuniões reais sem ninguém ter
pedido.

---

## O que falta: o OAuth Client no Google Cloud

Isto exige sua conta Google. Não é algo que eu possa fazer por você.

### 1. Criar o projeto e ativar as APIs

Em <https://console.cloud.google.com>:

1. Crie um projeto (ou use um existente)
2. Em **APIs e serviços → Biblioteca**, ative:
   - **Google Calendar API**
   - **Google Tasks API**

### 2. Tela de consentimento

Em **APIs e serviços → Tela de permissão OAuth**:

- Tipo: **Externo**
- Preencha nome do app, e-mail de suporte e e-mail do desenvolvedor
- Em **Usuários de teste**, adicione a sua própria conta Google

Enquanto o app estiver em **Teste**, só os usuários de teste conseguem conectar —
o que é exatamente o que você quer agora. Publicar exige verificação do Google
porque os escopos de Calendar são sensíveis.

### 3. Criar as credenciais

Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:

- Tipo: **Aplicativo da Web**
- Em **URIs de redirecionamento autorizados**, adicione exatamente:

```
https://wal-chat.64.181.178.125.nip.io/api/integrations/google/callback
```

Guarde o **Client ID** e o **Client secret**.

> **Atenção ao domínio.** O endereço atual é um `nip.io`, que resolve um IP para
> um nome. O Google pode recusá-lo como URI de redirecionamento, porque prefere
> domínios verificáveis. Se recusar, o caminho é apontar um domínio próprio para
> o servidor — o sistema já aceita um endereço diferente pela variável
> `GOOGLE_OAUTH_REDIRECT_URI`, sem mudar código. Vale tentar o `nip.io` primeiro:
> se funcionar, poupa o trabalho.

### 4. Colocar no servidor

As duas variáveis vão para `/opt/wal-chat/releases/<release>/.env.production`,
nunca para o repositório:

```
GOOGLE_CLIENT_ID=<o client id>
GOOGLE_CLIENT_SECRET=<o client secret>
```

Depois, subir a pilha de novo para o processo reler o ambiente. Me passe os
valores que eu aplico, ou aplique você — o passo é o mesmo dos outros segredos.

### 5. Conectar e configurar

1. Em **Calendário**, clique em **Conectar Google** e autorize com a sua conta
2. Escolha a agenda e a lista de tarefas
3. Em **Links de agenda**, crie uma agenda de reuniões: duração, horários da
   semana, intervalo entre reuniões e antecedência mínima
4. Em **IA**, vincule essa agenda ao agente

O passo 4 é o que liga as ferramentas. Sem ele a IA continua trabalhando como
antes.

---

## Como fica na prática

O lead manda mensagem no direct. A IA responde, e quando aparece intenção de
reunião ela consulta a agenda de verdade, oferece três horários espalhados pelos
dias, pede nome e e-mail em uma pergunta curta, marca, e devolve a confirmação
com o link do Meet. O convite chega no e-mail da pessoa e na sua agenda do
Google, com o Meet já criado.

Se a pessoa voltar depois pedindo para mudar, a IA move a reunião. Se pedir para
cancelar, ela libera o horário. Sempre a reunião daquela pessoa, nunca a de
outra.

---

## Detalhes que vieram de pensar no caso real

**A data de hoje entra nas instruções.** O modelo não tem relógio. Sem essa
linha, "amanhã" vira a data do treinamento e ele propõe um horário que já passou.

**A oferta se espalha pelos dias.** Seis horários da mesma terça-feira não são
uma escolha de verdade. O sistema pega um por dia antes de completar.

**Falha de ferramenta volta como orientação, não como exceção.** Quando o horário
é tomado no meio da conversa, o modelo precisa conseguir oferecer outro. Uma
exceção derrubaria a resposta inteira e deixaria o cliente sem retorno.

**Quando o Meet não sai, a ferramenta manda explicitamente não prometer link.**
A reunião existe; o link, não. É melhor confirmar sem link do que prometer um que
não chega.

**Falha fechada na consulta.** Se o Google está ligado e não responde, não
oferecemos horário nenhum. Oferecer sem validar é marcar no escuro, e quem
descobre é o cliente, na hora.

**Cancelar apaga no Google antes de marcar como cancelado aqui.** Um evento que
sobrevive ao cancelamento continua bloqueando o horário e chamando as pessoas
para uma reunião que não existe mais.

**Variável de ambiente em branco deixou de derrubar o processo.** `CHAVE=` chega
como string vazia e batia de frente com as regras de validação. Preparar uma
integração e sair para buscar o valor não pode matar o boot.
