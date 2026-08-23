-- Wal Chat — motor de automações DAG versionado, variáveis tipadas e execução auditável.

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (char_length(label) between 2 and 100),
  field_type text not null check (field_type in ('text','number','date','datetime','boolean')),
  description text check (description is null or char_length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, field_key)
);

create table public.automation_bot_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (char_length(label) between 2 and 100),
  field_type text not null check (field_type in ('text','number','date','datetime','boolean')),
  value jsonb not null default 'null'::jsonb,
  description text check (description is null or char_length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, field_key)
);

create table public.automation_flows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  description text check (description is null or char_length(description) <= 1000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  draft_graph jsonb not null,
  current_version integer not null default 0 check (current_version >= 0),
  current_version_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint automation_flows_graph_object check (jsonb_typeof(draft_graph) = 'object'),
  constraint automation_flows_graph_size check (octet_length(draft_graph::text) <= 262144),
  unique (workspace_id, name)
);

create table public.automation_flow_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid not null references public.automation_flows(id) on delete cascade,
  version integer not null check (version > 0),
  graph jsonb not null,
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default timezone('utc', now()),
  constraint automation_flow_versions_graph_object check (jsonb_typeof(graph) = 'object'),
  constraint automation_flow_versions_graph_size check (octet_length(graph::text) <= 262144),
  unique (flow_id, version)
);

alter table public.automation_flows
  add constraint automation_flows_current_version_fk
  foreign key (current_version_id) references public.automation_flow_versions(id) on delete set null;

create table public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid not null references public.automation_flows(id) on delete restrict,
  flow_version_id uuid not null references public.automation_flow_versions(id) on delete restrict,
  trigger_id uuid references public.triggers(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  source_interaction_id uuid references public.interactions_log(id) on delete set null,
  platform text not null check (platform in ('instagram','whatsapp')),
  status text not null default 'scheduled'
    check (status in ('scheduled','running','waiting','completed','blocked','failed','cancelled')),
  current_node_id text check (current_node_id is null or char_length(current_node_id) <= 64),
  context jsonb not null default '{}'::jsonb,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 180),
  steps_count integer not null default 0 check (steps_count between 0 and 1000),
  next_wake_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint automation_executions_context_object check (jsonb_typeof(context) = 'object'),
  constraint automation_executions_context_size check (octet_length(context::text) <= 131072),
  unique (workspace_id, idempotency_key)
);

create table public.automation_execution_steps (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  execution_id uuid not null references public.automation_executions(id) on delete cascade,
  node_id text not null check (char_length(node_id) between 1 and 64),
  node_type text not null check (char_length(node_type) between 2 and 40),
  status text not null check (status in ('running','scheduled','completed','blocked','failed')),
  attempt integer not null default 1 check (attempt between 1 and 100),
  output_summary jsonb not null default '{}'::jsonb,
  error_code text check (error_code is null or char_length(error_code) <= 120),
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint automation_steps_output_object check (jsonb_typeof(output_summary) = 'object'),
  unique (execution_id, node_id, attempt)
);

create index automation_flows_workspace_status_idx
  on public.automation_flows (workspace_id, status, updated_at desc);
create index automation_versions_flow_idx
  on public.automation_flow_versions (flow_id, version desc);
create index automation_executions_workspace_status_idx
  on public.automation_executions (workspace_id, status, updated_at desc);
create index automation_executions_contact_idx
  on public.automation_executions (contact_id, started_at desc);
create index automation_executions_wake_idx
  on public.automation_executions (next_wake_at)
  where status = 'waiting';
create index automation_steps_execution_idx
  on public.automation_execution_steps (execution_id, id);

alter table public.triggers add column if not exists flow_id uuid
  references public.automation_flows(id) on delete set null;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.triggers'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%response_text%'
      and pg_get_constraintdef(con.oid) like '%sequence_id%'
  loop
    execute format('alter table public.triggers drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.triggers
  add constraint triggers_exactly_one_destination
  check (num_nonnulls(response_text, sequence_id, flow_id) = 1);

alter table public.automation_runs
  add column if not exists flow_execution_id uuid
  references public.automation_executions(id) on delete set null;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.scheduled_jobs'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%sequence_step%'
      and pg_get_constraintdef(con.oid) like '%campaign_message%'
  loop
    execute format('alter table public.scheduled_jobs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.scheduled_jobs
  add constraint scheduled_jobs_kind_check
  check (kind in ('sequence_step','automation_step','campaign_message','content_publish','insights_sync'));

create trigger set_custom_field_definitions_updated_at
  before update on public.custom_field_definitions
  for each row execute procedure public.set_updated_at();
create trigger set_automation_bot_fields_updated_at
  before update on public.automation_bot_fields
  for each row execute procedure public.set_updated_at();
create trigger set_automation_flows_updated_at
  before update on public.automation_flows
  for each row execute procedure public.set_updated_at();
create trigger set_automation_executions_updated_at
  before update on public.automation_executions
  for each row execute procedure public.set_updated_at();

-- Defesa em profundidade: uma FK simples valida existência, mas não garante que
-- os recursos relacionados pertençam ao mesmo tenant.
create or replace function public.enforce_automation_execution_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.automation_flow_versions version
    join public.automation_flows flow on flow.id = version.flow_id
    where version.id = new.flow_version_id
      and version.workspace_id = new.workspace_id
      and version.flow_id = new.flow_id
      and flow.workspace_id = new.workspace_id
  ) then raise exception 'automation_flow_scope_invalid'; end if;
  if not exists (
    select 1 from public.contacts contact
    where contact.id = new.contact_id and contact.workspace_id = new.workspace_id
  ) then raise exception 'automation_contact_scope_invalid'; end if;
  if new.trigger_id is not null and not exists (
    select 1 from public.triggers trigger_row
    where trigger_row.id = new.trigger_id and trigger_row.workspace_id = new.workspace_id
  ) then raise exception 'automation_trigger_scope_invalid'; end if;
  if new.source_interaction_id is not null and not exists (
    select 1 from public.interactions_log interaction
    where interaction.id = new.source_interaction_id
      and interaction.workspace_id = new.workspace_id
      and interaction.contact_id = new.contact_id
  ) then raise exception 'automation_interaction_scope_invalid'; end if;
  return new;
end;
$$;

create or replace function public.enforce_automation_step_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.automation_executions execution
    where execution.id = new.execution_id
      and execution.workspace_id = new.workspace_id
  ) then raise exception 'automation_step_scope_invalid'; end if;
  return new;
end;
$$;

create or replace function public.enforce_trigger_flow_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.flow_id is not null and not exists (
    select 1 from public.automation_flows flow
    where flow.id = new.flow_id and flow.workspace_id = new.workspace_id
  ) then raise exception 'trigger_flow_scope_invalid'; end if;
  return new;
end;
$$;

create trigger enforce_automation_execution_scope
  before insert or update of workspace_id, flow_id, flow_version_id, trigger_id,
    contact_id, source_interaction_id on public.automation_executions
  for each row execute procedure public.enforce_automation_execution_scope();
create trigger enforce_automation_step_scope
  before insert or update of workspace_id, execution_id on public.automation_execution_steps
  for each row execute procedure public.enforce_automation_step_scope();
create trigger enforce_trigger_flow_scope
  before insert or update of workspace_id, flow_id on public.triggers
  for each row execute procedure public.enforce_trigger_flow_scope();

create or replace function public.validate_automation_field_value(field_type text, field_value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare string_value text;
begin
  if field_value = 'null'::jsonb then return true; end if;
  if field_type = 'text' then
    return jsonb_typeof(field_value) = 'string' and char_length(field_value #>> '{}') <= 4000;
  elsif field_type = 'number' then
    return jsonb_typeof(field_value) = 'number';
  elsif field_type = 'boolean' then
    return jsonb_typeof(field_value) = 'boolean';
  elsif field_type in ('date','datetime') then
    if jsonb_typeof(field_value) <> 'string' then return false; end if;
    string_value := field_value #>> '{}';
    if field_type = 'date' then
      perform string_value::date;
    else
      perform string_value::timestamptz;
    end if;
    return true;
  end if;
  return false;
exception when others then
  return false;
end;
$$;

create or replace function public.publish_automation_flow(
  target_workspace_id uuid,
  target_flow_id uuid,
  expected_revision integer,
  graph_payload jsonb,
  graph_checksum text,
  actor_user_id uuid
)
returns table (version_id uuid, version_number integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare target_flow public.automation_flows%rowtype;
declare next_version integer;
declare created_version_id uuid;
begin
  select * into target_flow
  from public.automation_flows flow
  where flow.id = target_flow_id and flow.workspace_id = target_workspace_id
  for update;
  if not found then raise exception 'automation_flow_not_found'; end if;
  if target_flow.status = 'archived' then raise exception 'automation_flow_archived'; end if;
  if target_flow.revision <> expected_revision then raise exception 'automation_revision_conflict'; end if;
  if jsonb_typeof(graph_payload) <> 'object' or octet_length(graph_payload::text) > 262144 then
    raise exception 'automation_graph_invalid';
  end if;
  if graph_checksum !~ '^[a-f0-9]{64}$' then raise exception 'automation_checksum_invalid'; end if;

  next_version := target_flow.current_version + 1;
  insert into public.automation_flow_versions (
    workspace_id, flow_id, version, graph, checksum, published_by
  ) values (
    target_workspace_id, target_flow_id, next_version, graph_payload, graph_checksum, actor_user_id
  ) returning id into created_version_id;

  update public.automation_flows
  set status = 'published',
      draft_graph = graph_payload,
      current_version = next_version,
      current_version_id = created_version_id,
      revision = revision + 1,
      updated_by = actor_user_id
  where id = target_flow_id;

  return query select created_version_id, next_version;
end;
$$;

create or replace function public.apply_automation_actions(
  target_workspace_id uuid,
  target_execution_id uuid,
  target_contact_id uuid,
  actions_payload jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare action_item jsonb;
declare action_type text;
declare target_tag_id uuid;
declare target_field_key text;
declare target_value jsonb;
declare definition_type text;
begin
  if jsonb_typeof(actions_payload) <> 'array' or jsonb_array_length(actions_payload) > 10 then
    raise exception 'automation_actions_invalid';
  end if;
  if not exists (
    select 1 from public.automation_executions execution
    where execution.id = target_execution_id
      and execution.workspace_id = target_workspace_id
      and execution.contact_id = target_contact_id
  ) then raise exception 'automation_execution_scope_invalid'; end if;

  for action_item in select value from jsonb_array_elements(actions_payload)
  loop
    action_type := action_item ->> 'type';
    if action_type in ('add_tag','remove_tag') then
      target_tag_id := (action_item ->> 'tagId')::uuid;
      if not exists (
        select 1 from public.tags tag
        where tag.id = target_tag_id and tag.workspace_id = target_workspace_id
      ) then raise exception 'automation_tag_invalid'; end if;
      if action_type = 'add_tag' then
        insert into public.contact_tags (workspace_id, contact_id, tag_id, source, metadata)
        values (
          target_workspace_id, target_contact_id, target_tag_id, 'system',
          jsonb_build_object('flowExecutionId', target_execution_id)
        ) on conflict (contact_id, tag_id) do nothing;
      else
        delete from public.contact_tags
        where workspace_id = target_workspace_id
          and contact_id = target_contact_id
          and tag_id = target_tag_id;
      end if;
    elsif action_type in ('set_custom_field','clear_custom_field') then
      target_field_key := action_item ->> 'fieldKey';
      select definition.field_type into definition_type
      from public.custom_field_definitions definition
      where definition.workspace_id = target_workspace_id
        and definition.field_key = target_field_key
        and definition.is_active;
      if definition_type is null then raise exception 'automation_custom_field_invalid'; end if;
      if action_type = 'clear_custom_field' then
        update public.contacts set custom_fields = custom_fields - target_field_key
        where id = target_contact_id and workspace_id = target_workspace_id;
      else
        target_value := action_item -> 'value';
        if not public.validate_automation_field_value(definition_type, target_value) then
          raise exception 'automation_custom_field_type_invalid';
        end if;
        update public.contacts
        set custom_fields = jsonb_set(custom_fields, array[target_field_key], target_value, true)
        where id = target_contact_id and workspace_id = target_workspace_id;
      end if;
    elsif action_type = 'set_bot_field' then
      target_field_key := action_item ->> 'fieldKey';
      target_value := action_item -> 'value';
      select field.field_type into definition_type
      from public.automation_bot_fields field
      where field.workspace_id = target_workspace_id
        and field.field_key = target_field_key
        and field.is_active
      for update;
      if definition_type is null then raise exception 'automation_bot_field_invalid'; end if;
      if not public.validate_automation_field_value(definition_type, target_value) then
        raise exception 'automation_bot_field_type_invalid';
      end if;
      update public.automation_bot_fields set value = target_value
      where workspace_id = target_workspace_id and field_key = target_field_key;
    else
      raise exception 'automation_action_unsupported';
    end if;
  end loop;
end;
$$;

alter table public.custom_field_definitions enable row level security;
alter table public.automation_bot_fields enable row level security;
alter table public.automation_flows enable row level security;
alter table public.automation_flow_versions enable row level security;
alter table public.automation_executions enable row level security;
alter table public.automation_execution_steps enable row level security;

create policy custom_fields_select on public.custom_field_definitions for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy custom_fields_manage on public.custom_field_definitions for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy bot_fields_select on public.automation_bot_fields for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy bot_fields_manage on public.automation_bot_fields for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy automation_flows_select on public.automation_flows for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy automation_flows_manage on public.automation_flows for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy automation_versions_select on public.automation_flow_versions for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy automation_executions_select on public.automation_executions for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy automation_steps_select on public.automation_execution_steps for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.custom_field_definitions, public.automation_bot_fields,
  public.automation_flows, public.automation_flow_versions,
  public.automation_executions, public.automation_execution_steps from anon, authenticated;
grant select on public.custom_field_definitions, public.automation_bot_fields,
  public.automation_flows, public.automation_flow_versions, public.automation_executions,
  public.automation_execution_steps to authenticated;
grant all on public.custom_field_definitions, public.automation_bot_fields,
  public.automation_flows, public.automation_flow_versions,
  public.automation_executions, public.automation_execution_steps to service_role;
grant usage, select on sequence public.automation_execution_steps_id_seq to service_role;

revoke all on function public.validate_automation_field_value(text, jsonb),
  public.publish_automation_flow(uuid, uuid, integer, jsonb, text, uuid),
  public.apply_automation_actions(uuid, uuid, uuid, jsonb),
  public.enforce_automation_execution_scope(),
  public.enforce_automation_step_scope(),
  public.enforce_trigger_flow_scope()
  from public, anon, authenticated;
grant execute on function public.validate_automation_field_value(text, jsonb),
  public.publish_automation_flow(uuid, uuid, integer, jsonb, text, uuid),
  public.apply_automation_actions(uuid, uuid, uuid, jsonb),
  public.enforce_automation_execution_scope(),
  public.enforce_automation_step_scope(),
  public.enforce_trigger_flow_scope()
  to service_role;

comment on table public.automation_flows is
  'Rascunho editável de um DAG; execuções usam sempre uma versão publicada e imutável.';
comment on table public.automation_executions is
  'Máquina de estados persistida por contato, versão e idempotency key.';
comment on function public.apply_automation_actions(uuid, uuid, uuid, jsonb) is
  'Aplica tags e variáveis tipadas de um nó de ação em uma única transação.';
