-- Wal Chat — operação real: gate por workspace, Inbox colaborativa,
-- observabilidade de webhooks, auditoria de automações e RAG textual.

create table public.workspace_runtime_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  external_sends_enabled boolean not null default false,
  comment_to_dm_enabled boolean not null default false,
  autonomous_ai_enabled boolean not null default false,
  activated_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.conversations
  add column if not exists status text not null default 'open',
  add column if not exists priority text not null default 'normal',
  add column if not exists resolved_at timestamptz,
  add column if not exists last_assigned_at timestamptz;

alter table public.conversations
  drop constraint if exists conversations_status_check,
  drop constraint if exists conversations_priority_check;

alter table public.conversations
  add constraint conversations_status_check
    check (status in ('open', 'pending', 'resolved')),
  add constraint conversations_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent'));

create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.webhook_events
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists event_type text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists duration_ms integer,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists replayed_at timestamptz,
  add column if not exists replayed_by uuid references auth.users(id) on delete set null;

update public.webhook_events event
set workspace_id = account.workspace_id
from public.instagram_accounts account
where event.workspace_id is null
  and event.instagram_user_id = account.instagram_user_id;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trigger_id uuid references public.triggers(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  interaction_id uuid references public.interactions_log(id) on delete set null,
  scheduled_job_id uuid references public.scheduled_jobs(id) on delete set null,
  source public.trigger_source not null,
  status text not null default 'matched',
  policy_used public.window_policy,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (trigger_id, interaction_id)
);

alter table public.automation_runs
  add constraint automation_runs_status_check
  check (status in ('matched', 'scheduled', 'sent', 'blocked', 'failed'));

alter table public.comment_private_replies
  add column if not exists trigger_id uuid references public.triggers(id) on delete set null,
  add column if not exists automation_run_id uuid references public.automation_runs(id) on delete set null;

alter table public.knowledge_documents
  add column if not exists source_type text not null default 'text',
  add column if not exists source_url text,
  add column if not exists checksum text,
  add column if not exists status text not null default 'ready',
  add column if not exists last_used_at timestamptz;

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_source_type_check,
  drop constraint if exists knowledge_documents_status_check;

alter table public.knowledge_documents
  add constraint knowledge_documents_source_type_check
    check (source_type in ('text', 'url', 'file')),
  add constraint knowledge_documents_status_check
    check (status in ('ready', 'processing', 'failed'));

create index workspace_runtime_settings_external_idx
  on public.workspace_runtime_settings (external_sends_enabled);
create index conversation_notes_conversation_created_idx
  on public.conversation_notes (conversation_id, created_at desc);
create index conversations_workspace_status_idx
  on public.conversations (workspace_id, status, last_message_at desc);
create index webhook_events_workspace_received_idx
  on public.webhook_events (workspace_id, received_at desc);
create index webhook_events_failed_idx
  on public.webhook_events (workspace_id, received_at desc)
  where status = 'failed';
create index automation_runs_workspace_created_idx
  on public.automation_runs (workspace_id, created_at desc);
create index automation_runs_trigger_status_idx
  on public.automation_runs (trigger_id, status, created_at desc);
create index knowledge_documents_search_idx
  on public.knowledge_documents using gin (
    to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(content, ''))
  );

create or replace function public.search_knowledge_documents(
  target_workspace_id uuid,
  target_agent_id uuid,
  search_text text,
  match_count integer default 5
)
returns table (
  id uuid,
  title text,
  content text,
  source_type text,
  source_url text,
  rank real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    document.id,
    document.title,
    document.content,
    document.source_type,
    document.source_url,
    ts_rank_cd(
      to_tsvector('portuguese', coalesce(document.title, '') || ' ' || coalesce(document.content, '')),
      websearch_to_tsquery('portuguese', search_text)
    )::real as rank
  from public.knowledge_documents document
  where document.workspace_id = target_workspace_id
    and document.status = 'ready'
    and (document.ai_agent_id = target_agent_id or document.ai_agent_id is null)
    and to_tsvector('portuguese', coalesce(document.title, '') || ' ' || coalesce(document.content, ''))
      @@ websearch_to_tsquery('portuguese', search_text)
  order by rank desc, document.updated_at desc
  limit greatest(1, least(match_count, 10));
$$;

create trigger set_workspace_runtime_settings_updated_at
  before update on public.workspace_runtime_settings
  for each row execute procedure public.set_updated_at();
create trigger set_conversation_notes_updated_at
  before update on public.conversation_notes
  for each row execute procedure public.set_updated_at();
create trigger set_automation_runs_updated_at
  before update on public.automation_runs
  for each row execute procedure public.set_updated_at();

alter table public.workspace_runtime_settings enable row level security;
alter table public.conversation_notes enable row level security;
alter table public.automation_runs enable row level security;

create policy workspace_runtime_settings_select
  on public.workspace_runtime_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy conversation_notes_select
  on public.conversation_notes for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy conversation_notes_insert
  on public.conversation_notes for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]));
create policy conversation_notes_update
  on public.conversation_notes for update to authenticated
  using (author_user_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (author_user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy conversation_notes_delete
  on public.conversation_notes for delete to authenticated
  using (author_user_id = auth.uid() and public.is_workspace_member(workspace_id));

create policy automation_runs_select
  on public.automation_runs for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.workspace_runtime_settings from authenticated;
revoke insert, update, delete on public.automation_runs from authenticated;
revoke all on function public.search_knowledge_documents(uuid, uuid, text, integer) from public, anon, authenticated;

grant select on public.workspace_runtime_settings to authenticated;
grant select, insert, update, delete on public.conversation_notes to authenticated;
grant select on public.automation_runs to authenticated;
grant all on public.workspace_runtime_settings to service_role;
grant all on public.conversation_notes to service_role;
grant all on public.automation_runs to service_role;
grant execute on function public.search_knowledge_documents(uuid, uuid, text, integer) to service_role;

comment on table public.workspace_runtime_settings is
  'Kill switches por workspace; DEMO_MODE=false continua obrigatório no ambiente.';
comment on table public.automation_runs is
  'Trilha operacional de cada gatilho, incluindo Comment-to-DM e decisão de compliance.';
comment on function public.search_knowledge_documents(uuid, uuid, text, integer) is
  'Busca textual provider-agnostic para o copiloto citar somente fontes relevantes.';
