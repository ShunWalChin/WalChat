# Histórico de versões

## 0.1.0 — 12 de setembro de 2026 · Beta

Primeira versão marcada. O sistema já estava no ar; esta versão existe porque o
código e a produção voltaram a ser a mesma coisa — e porque um beta com gente de
fora exige um ponto de retorno com nome.

### O que esta versão reconcilia

A produção estava **doze dias atrasada**: rodava a release de 31/08 enquanto o
repositório tinha onze commits e sete migrations nunca aplicadas, mais vinte e
cinco arquivos alterados soltos na árvore. Não é uma questão de funcionalidade
faltando — é que ninguém sabia, com certeza, o que estava no ar.

Foram aplicadas as sete migrations pendentes: capacidades do OpenReply,
conversões OCI e CAPI, correspondência por palavra inteira nos gatilhos,
atomicidade e escala do CRM, ativos de CRM, SLOs operacionais e atribuição
Click-to-WhatsApp. O esquema foi de 76 para 84 tabelas, e os dados existentes
sobreviveram — três contatos, uma conversa, nove mensagens.

### O que o beta ganhou hoje

**Backup automático, com verificação.** Existiam dezoito backups, todos feitos à
mão antes de cada deploy. Agora há um diário às 04:15 UTC, declarado em
`/etc/cron.d/wal-chat-backup` em vez de num crontab invisível. O script recusa
dump menor que 100 KB e confere a integridade com `pg_restore --list`: um backup
que "funcionou" e veio vazio é pior que um que falhou, porque ninguém descobre
até precisar restaurar. Retenção de quatorze dias.

**Teto de gasto de IA.** A tabela de orçamento estava vazia, e sem linha nela o
código devolve limite zero e desliga a própria checagem — com IA autônoma e
envios externos ligados, era uma torneira aberta. Ficou em cinco milhões de
tokens por mês por workspace, com aviso em 80% e parada rígida. É folgado para
teste real e é um ajuste de trinta segundos se apertar.

**Conta do Instagram com status verdadeiro.** `wal.chat` estava marcada como
conectada sem ter credencial nenhuma. O snapshot de seguidores tentava a cada
hora e falhava, enchendo o log. Log que grita toda hora esconde o erro de
verdade quando ele vem. O status virou `expired`, que é o estado real; os
contatos e a conversa histórica ficaram, porque apontam para a conta por id e o
Inbox não filtra conversa por status.

### Estado verificado

Quatro serviços saudáveis. Supabase em 11 ms, Redis em 9 ms. Telas públicas e
internas em 200, rota inexistente em 404, rota privada sem token em 401. Zero
erro nos três logs depois do deploy.

Portão completo: tsc, lint, 448 testes em 65 arquivos, auditor de sistema,
prettier e build.

### O que ainda não está pronto para cliente pagante

Registrado aqui porque beta é teste, não lançamento comercial:

- **Credenciais em histórico público do Git.** Chave SSH e senhas
  administrativas já publicadas. Redigir o arquivo não desfaz o que foi
  publicado — exige rotação.
- **Domínio `nip.io`.** Passou no OAuth Client do Google, mas não passa na
  verificação — verificar exige provar propriedade do domínio.
- **App do Google em modo Teste.** Só autoriza contas cadastradas como
  testadoras, e a conta do dono ainda não está na lista.
- **Meta sem App Review.** Conectar o Instagram de outra pessoa depende disso.
- **Sem cobrança.** A coluna `plan` existe e nada a lê.
- **Base de conhecimento da IA vazia.** Ela atende bem e não sabe o preço.

### Grafo de conhecimento

A lógica do sistema virou grafo gerado: 333 nós e 1570 relações, extraídos do
código a cada execução de `npm run knowledge:export`, com regras, decisões,
armadilhas e fluxos escritos à mão por cima. Referência a nó inexistente quebra
o gerador em vez de virar documentação falsa.
