-- Wal Chat — Automation Studio v2: eventos externos definidos por nós do DAG.
-- A carga continua limitada, assinada e entregue pela outbox n8n existente.

update public.integration_connections
set event_subscriptions = array_append(event_subscriptions, 'automation.node')
where provider = 'n8n'
  and not ('automation.node' = any(event_subscriptions));

comment on column public.integration_connections.event_subscriptions is
  'Eventos permitidos para a outbox n8n, incluindo etapas explícitas do Automation Studio.';

alter table public.conversation_notes
  add column if not exists automation_execution_id uuid
    references public.automation_executions(id) on delete cascade,
  add column if not exists automation_node_id text
    check (automation_node_id is null or char_length(automation_node_id) between 1 and 64);

alter table public.conversation_notes
  add constraint conversation_notes_automation_node_unique
  unique (automation_execution_id, automation_node_id);

create or replace function public.enforce_automation_note_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.automation_execution_id is not null and not exists (
    select 1 from public.automation_executions execution
    where execution.id = new.automation_execution_id
      and execution.workspace_id = new.workspace_id
      and new.automation_node_id is not null
  ) then raise exception 'automation_note_scope_invalid'; end if;
  return new;
end;
$$;

drop trigger if exists enforce_automation_note_scope on public.conversation_notes;
create trigger enforce_automation_note_scope
  before insert or update of workspace_id, automation_execution_id, automation_node_id
  on public.conversation_notes
  for each row execute procedure public.enforce_automation_note_scope();

revoke all on function public.enforce_automation_note_scope()
  from public, anon, authenticated;
grant execute on function public.enforce_automation_note_scope() to service_role;

-- Corrige o claim de idempotência para a mídia já suportada pelos senders.
alter table public.outbound_deliveries
  drop constraint if exists outbound_deliveries_message_type_check;
alter table public.outbound_deliveries
  add constraint outbound_deliveries_message_type_check check (
    (message_type in ('text', 'image', 'video') and template_name is null and template_language is null)
    or
    (message_type = 'template' and template_name is not null and template_language is not null)
  );
