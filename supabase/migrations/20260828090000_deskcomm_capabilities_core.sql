-- Wal Chat — capacidades operacionais inspiradas no DeskcommCRM (MIT).
-- Reimplementação nativa: workspace continua sendo a fronteira de tenant.

alter table public.workspace_runtime_settings
  add column if not exists routing_strategy text not null default 'round_robin',
  add column if not exists max_open_conversations integer not null default 20,
  add column if not exists business_hours jsonb not null default '{"timezone":"America/Sao_Paulo","weekdays":[1,2,3,4,5],"start":"08:00","end":"18:00"}'::jsonb;

alter table public.workspace_runtime_settings
  drop constraint if exists workspace_runtime_settings_routing_strategy_check,
  drop constraint if exists workspace_runtime_settings_max_open_conversations_check,
  add constraint workspace_runtime_settings_routing_strategy_check
    check (routing_strategy in ('round_robin', 'least_loaded', 'manual')),
  add constraint workspace_runtime_settings_max_open_conversations_check
    check (max_open_conversations between 1 and 500);

create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  description text check (description is null or char_length(description) <= 500),
  is_default boolean not null default false,
  position numeric not null default 1000,
  vocabulary jsonb not null default '{"lead":"Lead","leadPlural":"Leads","deal":"Oportunidade","dealPlural":"Oportunidades","won":"Ganho","lost":"Perdido","stage":"Etapa","stagePlural":"Etapas"}'::jsonb,
  settings jsonb not null default '{"lostReasons":[],"fields":[]}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, slug)
);

create unique index if not exists crm_pipelines_one_default_idx
  on public.crm_pipelines (workspace_id) where is_default and archived_at is null;

create table if not exists public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  description text check (description is null or char_length(description) <= 500),
  position numeric not null default 1000,
  color text not null default '#6B7280' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  terminal_state text not null default 'open' check (terminal_state in ('open', 'won', 'lost')),
  requires_human boolean not null default false,
  expected_duration_hours numeric not null default 72 check (expected_duration_hours > 0),
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (pipeline_id, slug),
  unique (id, workspace_id),
  unique (id, pipeline_id, workspace_id)
);

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  stage_id uuid not null,
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  description text check (description is null or char_length(description) <= 3000),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 240),
  position_in_stage numeric not null default 1000,
  value_cents bigint check (value_cents is null or value_cents >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  owner_user_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  last_activity_at timestamptz,
  next_action_at timestamptz,
  expected_close_date date,
  closed_at timestamptz,
  source text not null default 'manual' check (char_length(source) between 2 and 60),
  source_metadata jsonb not null default '{}'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  lock_version integer not null default 1 check (lock_version > 0),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (stage_id, pipeline_id, workspace_id)
    references public.crm_stages(id, pipeline_id, workspace_id),
  constraint crm_leads_closed_consistency check (
    (status = 'open' and closed_at is null)
    or (status in ('won', 'lost') and closed_at is not null)
  ),
  constraint crm_leads_lost_reason_required check (
    status <> 'lost' or nullif(btrim(lost_reason), '') is not null
  )
);

create table if not exists public.crm_lead_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  activity_type text not null check (char_length(activity_type) between 2 and 80),
  payload jsonb not null default '{}'::jsonb,
  performed_by_user_id uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.crm_lead_scores (
  lead_id uuid primary key references public.crm_leads(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  probability numeric(5,2) check (probability is null or probability between 0 and 100),
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  band text check (band is null or band in ('frio', 'morno', 'quente')),
  calculated_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint crm_lead_scores_reason_required check (
    probability is null or nullif(btrim(reason), '') is not null
  ),
  constraint crm_lead_scores_band_coherence check (
    band is null or probability is null
    or (band = 'quente' and probability >= 65)
    or (band = 'morno' and probability between 35 and 75)
    or (band = 'frio' and probability <= 45)
  )
);

create table if not exists public.crm_lead_risk_states (
  lead_id uuid primary key references public.crm_leads(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bucket text not null check (bucket in ('em_dia', 'em_voo', 'em_risco', 'critico')),
  since timestamptz not null,
  detected_at timestamptz not null default timezone('utc', now()),
  cold_hours numeric not null check (cold_hours > 0),
  updated_at timestamptz not null default timezone('utc', now()),
  check (since <= detected_at)
);

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) between 1 and 4000),
  shortcut text check (shortcut is null or shortcut ~ '^/[a-z0-9_-]{1,30}$'),
  category text not null default 'geral' check (char_length(category) between 2 and 40),
  use_count integer not null default 0 check (use_count >= 0),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, shortcut)
);

create table if not exists public.attendant_availability (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_available boolean not null default false,
  capacity integer not null default 5 check (capacity between 1 and 100),
  schedule jsonb not null default '{}'::jsonb,
  last_heartbeat_at timestamptz,
  last_assigned_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, user_id)
);

create table if not exists public.webhook_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  token_hash text not null check (char_length(token_hash) = 64),
  pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  stage_id uuid references public.crm_stages(id) on delete set null,
  field_mapping jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_received_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (stage_id, pipeline_id, workspace_id)
    references public.crm_stages(id, pipeline_id, workspace_id),
  unique (workspace_id, name)
);

create table if not exists public.webhook_lead_captures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null references public.webhook_sources(id) on delete cascade,
  dedupe_key text not null check (char_length(dedupe_key) = 64),
  lead_id uuid references public.crm_leads(id) on delete set null,
  status text not null default 'received' check (status in ('received', 'processed', 'rejected', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  error_code text,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  unique (source_id, dedupe_key)
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  event_type text not null check (char_length(event_type) between 2 and 80),
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  last_run_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.automation_rule_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  event_id uuid,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'skipped')),
  action_results jsonb not null default '[]'::jsonb,
  error_code text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.ai_agent_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  change_summary text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz,
  unique (agent_id, version)
);

create table if not exists public.ai_budgets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  monthly_limit_cents integer not null default 0 check (monthly_limit_cents >= 0),
  monthly_token_limit bigint not null default 0 check (monthly_token_limit >= 0),
  warning_percent integer not null default 80 check (warning_percent between 1 and 100),
  hard_stop boolean not null default true,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_routers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  description text,
  strategy text not null default 'intent' check (strategy in ('intent', 'priority', 'fallback')),
  is_active boolean not null default false,
  fallback_agent_id uuid references public.ai_agents(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, name)
);

create table if not exists public.ai_router_members (
  router_id uuid not null references public.ai_routers(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  intent text not null check (char_length(intent) between 2 and 120),
  priority integer not null default 100,
  examples text[] not null default '{}',
  primary key (router_id, agent_id, intent)
);

create table if not exists public.org_memory_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  memory_key text not null check (memory_key ~ '^[a-z0-9][a-z0-9_.-]{1,79}$'),
  value text not null check (char_length(value) between 1 and 4000),
  source text not null default 'manual',
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, memory_key)
);

create table if not exists public.agent_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid references public.ai_agents(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null check (char_length(title) between 2 and 180),
  reason text not null check (char_length(reason) between 2 and 120),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'dismissed')),
  assigned_to uuid references auth.users(id) on delete set null,
  summary text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz
);

create table if not exists public.agent_case_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.agent_cases(id) on delete cascade,
  event_type text not null check (char_length(event_type) between 2 and 80),
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_execution_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid references public.ai_agents(id) on delete set null,
  provider text not null,
  model text not null,
  purpose text not null default 'conversation',
  status text not null check (status in ('running', 'completed', 'failed', 'blocked')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_cents numeric(12,4) not null default 0 check (cost_cents >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.api_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 2 and 100),
  resource_type text not null check (char_length(resource_type) between 2 and 80),
  resource_id uuid,
  changes jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists crm_stages_pipeline_position_idx on public.crm_stages (pipeline_id, position);
create index if not exists crm_leads_board_idx on public.crm_leads (workspace_id, pipeline_id, stage_id, status, position_in_stage);
create index if not exists crm_leads_owner_idx on public.crm_leads (workspace_id, owner_user_id, status);
create index if not exists crm_leads_next_action_idx on public.crm_leads (workspace_id, next_action_at) where status = 'open';
create index if not exists crm_lead_activities_timeline_idx on public.crm_lead_activities (lead_id, performed_at desc);
create index if not exists crm_lead_risk_workspace_idx on public.crm_lead_risk_states (workspace_id, bucket, since);
create index if not exists message_templates_workspace_idx on public.message_templates (workspace_id, category, updated_at desc);
create index if not exists attendant_availability_online_idx on public.attendant_availability (workspace_id) where is_available;
create index if not exists webhook_captures_workspace_idx on public.webhook_lead_captures (workspace_id, received_at desc);
create unique index if not exists webhook_sources_token_hash_idx on public.webhook_sources (token_hash);
create index if not exists automation_rule_runs_workspace_idx on public.automation_rule_runs (workspace_id, started_at desc);
create index if not exists ai_agent_versions_agent_idx on public.ai_agent_versions (agent_id, version desc);
create index if not exists ai_execution_log_workspace_idx on public.ai_execution_log (workspace_id, created_at desc);
create index if not exists agent_cases_workspace_idx on public.agent_cases (workspace_id, status, priority, created_at desc);
create index if not exists api_audit_log_workspace_idx on public.api_audit_log (workspace_id, created_at desc);

create or replace function public.bootstrap_workspace_crm()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  pipeline_uuid uuid;
begin
  insert into public.crm_pipelines (workspace_id, name, slug, description, is_default)
  values (new.id, 'Pipeline comercial', 'comercial', 'Pipeline padrão do Wal Chat.', true)
  returning id into pipeline_uuid;

  insert into public.crm_stages (workspace_id, pipeline_id, name, slug, position, color, terminal_state, expected_duration_hours)
  values
    (new.id, pipeline_uuid, 'Novo lead', 'novo', 1000, '#3B82F6', 'open', 24),
    (new.id, pipeline_uuid, 'Qualificação', 'qualificacao', 2000, '#8B5CF6', 'open', 48),
    (new.id, pipeline_uuid, 'Proposta', 'proposta', 3000, '#F59E0B', 'open', 72),
    (new.id, pipeline_uuid, 'Negociação', 'negociacao', 4000, '#EC4899', 'open', 72),
    (new.id, pipeline_uuid, 'Ganho', 'ganho', 5000, '#16A34A', 'won', 720),
    (new.id, pipeline_uuid, 'Perdido', 'perdido', 6000, '#6B7280', 'lost', 720);
  return new;
end;
$$;

drop trigger if exists bootstrap_workspace_crm_trigger on public.workspaces;
create trigger bootstrap_workspace_crm_trigger
after insert on public.workspaces
for each row execute function public.bootstrap_workspace_crm();

do $$
declare
  workspace_row record;
  pipeline_uuid uuid;
begin
  for workspace_row in
    select w.* from public.workspaces w
    where not exists (
      select 1 from public.crm_pipelines p where p.workspace_id = w.id
    )
  loop
    insert into public.crm_pipelines (
      workspace_id, name, slug, description, is_default
    ) values (
      workspace_row.id,
      'Pipeline comercial',
      'comercial',
      'Pipeline padrão do Wal Chat.',
      true
    ) returning id into pipeline_uuid;

    insert into public.crm_stages (
      workspace_id, pipeline_id, name, slug, position, color,
      terminal_state, expected_duration_hours
    ) values
      (workspace_row.id, pipeline_uuid, 'Novo lead', 'novo', 1000, '#3B82F6', 'open', 24),
      (workspace_row.id, pipeline_uuid, 'Qualificação', 'qualificacao', 2000, '#8B5CF6', 'open', 48),
      (workspace_row.id, pipeline_uuid, 'Proposta', 'proposta', 3000, '#F59E0B', 'open', 72),
      (workspace_row.id, pipeline_uuid, 'Negociação', 'negociacao', 4000, '#EC4899', 'open', 72),
      (workspace_row.id, pipeline_uuid, 'Ganho', 'ganho', 5000, '#16A34A', 'won', 720),
      (workspace_row.id, pipeline_uuid, 'Perdido', 'perdido', 6000, '#6B7280', 'lost', 720);
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_pipelines','crm_stages','crm_leads','crm_lead_activities',
    'crm_lead_scores','crm_lead_risk_states','message_templates',
    'attendant_availability','webhook_sources','webhook_lead_captures',
    'automation_rules','automation_rule_runs','ai_agent_versions','ai_budgets',
    'ai_routers','ai_router_members','org_memory_entries','agent_cases',
    'agent_case_events','ai_execution_log','api_audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      table_name || '_select', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_write', table_name);
    execute format('revoke insert, update, delete on public.%I from authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_pipelines','crm_stages','crm_leads','message_templates','webhook_sources',
    'automation_rules','ai_routers','org_memory_entries','agent_cases'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

create or replace function public.bump_crm_lead_lock_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.lock_version = old.lock_version + 1;
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists crm_leads_lock_version_trigger on public.crm_leads;
create trigger crm_leads_lock_version_trigger
before update on public.crm_leads
for each row execute function public.bump_crm_lead_lock_version();

revoke all on function public.bootstrap_workspace_crm() from public, anon, authenticated;
grant execute on function public.bootstrap_workspace_crm() to service_role;
revoke all on function public.bump_crm_lead_lock_version() from public;
grant execute on function public.bump_crm_lead_lock_version() to authenticated, service_role;
