-- Espera por resposta do contato no motor de automações.
--
-- Até aqui a execução só sabia esperar o relógio (nó de delay) ou a confirmação
-- de uma entrega. Botões e perguntas exigem um terceiro tipo de espera: parar e
-- só continuar quando o contato mandar alguma coisa.

-- 'waiting' continua sendo a espera por tempo do nó de delay. A espera por
-- resposta ganha estado próprio para que o índice de acordar por relógio não
-- passe a varrer execuções que nunca vão acordar sozinhas.
alter table public.automation_executions
  drop constraint if exists automation_executions_status_check;
alter table public.automation_executions
  add constraint automation_executions_status_check
  check (status in (
    'scheduled','running','waiting','waiting_reply',
    'completed','blocked','failed','cancelled'
  ));

alter table public.automation_executions
  add column if not exists awaiting_kind text
    check (awaiting_kind is null or awaiting_kind in ('choice','input')),
  add column if not exists awaiting_node_id text
    check (awaiting_node_id is null or char_length(awaiting_node_id) <= 64),
  add column if not exists awaiting_until timestamptz,
  -- Conta as respostas inválidas já recebidas neste nó, para o `maxAttempts`
  -- do nó de pergunta não depender de recontar a trilha a cada mensagem.
  add column if not exists awaiting_attempts integer not null default 0
    check (awaiting_attempts between 0 and 10);

comment on column public.automation_executions.awaiting_kind is
  'Tipo de espera ativa: escolha de botão ou resposta livre a uma pergunta.';
comment on column public.automation_executions.awaiting_until is
  'Prazo da espera. O job de timeout usa este valor como chave de desempate.';

-- Um contato pode estar em mais de um fluxo. A resposta vai para a espera mais
-- recente, então a ordem faz parte do índice em vez de ficar só na query.
create index if not exists automation_executions_awaiting_idx
  on public.automation_executions (workspace_id, contact_id, updated_at desc)
  where status = 'waiting_reply';

-- O varredor de prazos vencidos só precisa enxergar quem está esperando.
create index if not exists automation_executions_awaiting_deadline_idx
  on public.automation_executions (awaiting_until)
  where status = 'waiting_reply' and awaiting_until is not null;

-- Nova espécie de job: acorda a execução cujo prazo de resposta venceu.
alter table public.scheduled_jobs
  drop constraint if exists scheduled_jobs_kind_check;
alter table public.scheduled_jobs
  add constraint scheduled_jobs_kind_check
  check (kind in (
    'sequence_step', 'automation_step', 'integration_event',
    'automation_await_timeout',
    'campaign_message', 'content_publish', 'insights_sync'
  ));
