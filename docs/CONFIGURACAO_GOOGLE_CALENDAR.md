# Google Calendar, Meet e Tasks no Wal Chat

Este documento descreve a configuração real do calendário operacional, desde o
Google Cloud até o teste de uma reserva criada por um lead. O Google é opcional:
sem OAuth configurado, eventos e tarefas locais continuam funcionando.

## 1. O que está implementado

- OAuth 2.0 Authorization Code com `state`, PKCE S256, cookie `HttpOnly`,
  `SameSite=Lax` e expiração de dez minutos;
- access token e refresh token cifrados por workspace/conexão com AES-256-GCM;
- lista de calendários com permissão de escrita e seleção da agenda operacional;
- CRUD de eventos, convidados e Google Meet;
- Google Tasks com criação, atualização, conclusão e exclusão;
- sincronização incremental com `nextSyncToken` e recuperação por full sync em
  resposta HTTP 410;
- consulta Free/Busy antes de oferecer ou reservar horários;
- reserva transacional no Postgres para impedir duas confirmações concorrentes;
- páginas públicas `/agendar/:slug` com duração, horário, buffer, antecedência,
  janela futura, telefone obrigatório e Meet opcional;
- vínculo da página de agenda com gatilhos, sequências e agentes de IA;
- calendário unificado com eventos, tarefas, agendamentos, conteúdo, campanhas,
  sequências, jobs e trilha temporal do produto.

## 2. Criar o projeto no Google Cloud

1. Acesse [Google Cloud Console](https://console.cloud.google.com/).
2. Crie ou selecione um projeto exclusivo para o Wal Chat.
3. Em **APIs e serviços > Biblioteca**, habilite:
   - Google Calendar API;
   - Google Tasks API.
4. Em **Google Auth Platform**, configure nome do app, email de suporte e
   contatos do desenvolvedor.
5. Em **Audience**, use `External` quando contas Google fora da organização
   precisarem conectar. Durante homologação, cadastre somente usuários de teste.
6. Em **Data Access**, declare os escopos usados pelo backend:
   - `openid`;
   - `email`;
   - `profile`;
   - `https://www.googleapis.com/auth/calendar.events`;
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`;
   - `https://www.googleapis.com/auth/tasks`.

O Wal Chat não pede acesso total a todos os calendários. A lista é somente
leitura; a escrita é limitada a eventos e à lista de tarefas selecionada.

## 3. Criar o OAuth Client

1. Abra **Clients > Create client**.
2. Escolha **Web application**.
3. Cadastre a origem pública da aplicação, por exemplo:

   ```text
   https://wal-chat.64.181.178.125.nip.io
   ```

4. Cadastre exatamente a URI de redirecionamento mostrada no modal Google do
   Wal Chat:

   ```text
   https://wal-chat.64.181.178.125.nip.io/api/integrations/google/callback
   ```

5. Guarde o Client ID e Client Secret no cofre de secrets. Nunca coloque esses
   valores em variáveis `VITE_*`, commits, screenshots ou tickets.

Para desenvolvimento local, cadastre também:

```text
http://localhost:3001
http://localhost:3001/api/integrations/google/callback
```

## 4. Variáveis do backend

```dotenv
GOOGLE_CLIENT_ID=cliente.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=segredo-do-oauth-client
GOOGLE_OAUTH_REDIRECT_URI=https://seu-dominio/api/integrations/google/callback
APP_ORIGIN=https://seu-dominio
CREDENTIALS_ENCRYPTION_KEY=base64-ou-hex-com-32-bytes
```

Após alterar o ambiente, reconstrua/reinicie somente a release do Wal Chat. A
tela deve mudar de **Backend pendente** para **Pronto para conectar**.

## 5. Conectar uma conta no Wal Chat

1. Entre como `owner` ou `admin`.
2. Abra **Calendário > Conectar Google**.
3. Revise a conta e os escopos no consentimento Google.
4. Após o retorno, abra as configurações do calendário.
5. Escolha:
   - calendário que receberá eventos e reuniões;
   - lista que receberá tarefas.
6. Clique **Salvar** e depois **Sincronizar**.

Um `agent` pode operar eventos e tarefas, mas não inicia nem remove a conexão
OAuth. Um `viewer` possui somente leitura.

## 6. Criar evento, tarefa e Meet

Na tela de calendário:

- clique em um número do mês ou no cabeçalho do dia da semana;
- informe título, início, término, local, convidados e contato do CRM;
- marque **Sincronizar com Google** para criar o evento externo;
- marque **Criar Google Meet** para solicitar uma conferência única;
- use **Novo > Tarefa** pelo editor e selecione prazo, prioridade e status;
- arraste evento/tarefa para outro dia ou abra o item e altere a data pelo
  teclado. O formulário é a alternativa acessível ao drag-and-drop.

Se o Google falhar, o item local é preservado como `sync_error`; a tela informa
a falha e uma sincronização posterior pode reconciliar o estado. Tokens e
respostas Google nunca são retornados à interface.

## 7. Criar página de agendamento

1. Abra **Calendário > Links de agenda**.
2. Configure nome, slug, descrição, duração e fuso IANA.
3. Selecione os dias da semana e defina início/fim, buffer, antecedência mínima
   e janela futura.
4. Escolha se telefone é obrigatório e se o Meet será criado.
5. Copie o link e teste em uma janela anônima.

Antes de confirmar, o backend:

1. recalcula os slots permitidos no fuso da página;
2. consulta reservas locais concorrentes;
3. consulta Free/Busy do calendário Google conectado;
4. adquire um lock transacional por página;
5. rejeita qualquer sobreposição;
6. cria/associa o contato no CRM;
7. cria a reserva, o evento, convidados e o Meet.

Quando o Google conectado não pode ser consultado, o sistema falha fechado e
não oferece o horário. Isso evita dupla reserva silenciosa.

## 8. Usar nos fluxos e agentes

### Gatilhos

Selecione uma página em **Levar para agendamento**. Use
`{{booking_link}}` no texto para escolher a posição exata. Sem o marcador, o
backend acrescenta o endereço ao final da resposta antes do rodapé de opt-out.

O link passa pelo scheduler normal; janela Meta, opt-out, cooldown, blocklist e
idempotência continuam obrigatórios.

### Sequências

Quando o gatilho de origem possui uma página, o identificador é propagado por
todos os jobs da sequência. O primeiro bloco de mensagem aplicável recebe o
link oficial, nunca uma URL informada pelo payload externo.

### Agentes de IA

Em **Agentes de IA**, selecione a agenda oficial. O prompt interno permite
oferecê-la uma única vez quando a pessoa demonstra intenção de reunião,
orçamento ou atendimento. O modelo não decide disponibilidade e não reserva:
ele fornece o link; o endpoint público executa todas as validações.

## 9. Matriz mínima de homologação

| Teste                     | Resultado esperado                                    |
| ------------------------- | ----------------------------------------------------- |
| OAuth cancelado           | Retorno seguro, sem conexão nem token parcial         |
| OAuth concluído           | Conta, calendários e listas aparecem sem expor token  |
| Evento local              | Persiste e aparece em mês, semana e agenda            |
| Evento Google             | Aparece no Wal Chat e Google Calendar                 |
| Evento com convidado      | Convite é enviado pelo Google                         |
| Meet                      | URL única aparece no evento e no convite              |
| Tarefa                    | Sincroniza com a lista selecionada                    |
| Drag/reagendamento        | Preserva duração e atualiza Google                    |
| Reserva pública           | Cria lead, booking, evento e Meet                     |
| Duas reservas simultâneas | Uma confirma; a outra recebe conflito 409             |
| Horário ocupado no Google | Não aparece como disponível                           |
| Free/Busy indisponível    | Endpoint falha fechado; nenhum slot é oferecido       |
| Gatilho com agenda        | Link oficial é inserido e compliance é preservado     |
| Agente com agenda         | IA oferece o link somente quando apropriado           |
| Desconexão                | Tokens são apagados e operações Google são bloqueadas |

## 10. Diagnóstico

### `redirect_uri_mismatch`

Compare, caractere a caractere, a URI exibida pelo Wal Chat, a variável
`GOOGLE_OAUTH_REDIRECT_URI` e a URI cadastrada no OAuth Client.

### Refresh token ausente

O fluxo usa `access_type=offline` e `prompt=consent`. Desconecte e conecte
novamente. Se o usuário revogou o app na Conta Google, uma nova autorização é
obrigatória.

### Calendário não aparece

Somente agendas em que a conta possui papel de escrita são listadas. Confirme o
compartilhamento no Google Calendar.

### Sync HTTP 410

O token incremental expirou. O backend apaga o token e executa full sync
automaticamente, mantendo a janela de 90 dias anteriores e 365 dias futuros.

### Evento local com `sync_error`

Confirme status OAuth, refresh token, calendário selecionado e permissões. Não
duplique manualmente: a criação usa `walChatEventId` em `extendedProperties`
para reconciliar retries sem criar outro evento.

## 11. Segurança e privacidade

- tokens ficam somente no backend, cifrados com AAD de workspace, provedor,
  tipo e conexão;
- tabelas de credenciais e states não têm acesso `anon/authenticated`;
- todas as mutações privadas exigem JWT, workspace, papel e origem confiável;
- páginas públicas não recebem `service_role` e usam endpoints validados;
- os dados públicos retornados não incluem workspace ID, connection ID ou
  tokens;
- rate limit e idempotency key reduzem abuso/replay;
- logs registram códigos operacionais, não token, email de convidado ou payload
  completo do Google;
- ao desconectar, o backend tenta revogar a concessão no Google e sempre
  elimina access token e refresh token locais; uma falha externa de revogação
  gera aviso para conferência manual na Conta Google.

Referências oficiais: [OAuth 2.0 para aplicações web](https://developers.google.com/identity/protocols/oauth2/web-server),
[Events: insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[sincronização incremental](https://developers.google.com/workspace/calendar/api/guides/sync),
[FreeBusy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
e [Google Tasks API](https://developers.google.com/workspace/tasks/reference/rest).
