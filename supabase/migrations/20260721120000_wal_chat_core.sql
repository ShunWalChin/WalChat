-- Wal Chat — schema multi-tenant, compliance Meta e módulos do MVP
-- O workspace é a fronteira do tenant; tabelas públicas recebem RLS e o schema
-- private fica restrito à service role para armazenar credenciais por conta.
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create type public.workspace_role as enum ('owner', 'admin', 'agent', 'viewer');
create type public.interaction_channel as enum ('dm', 'comment', 'story_reply', 'mention', 'reaction', 'postback');
create type public.interaction_direction as enum ('inbound', 'outbound');
create type public.message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed', 'blocked');
create type public.trigger_source as enum ('comment', 'dm', 'story');
create type public.match_mode as enum ('exact', 'contains');
create type public.sequence_step_kind as enum ('text', 'media', 'typing');
create type public.ai_agent_mode as enum ('copilot', 'autonomous');
create type public.content_kind as enum ('feed', 'reel', 'story', 'carousel');
create type public.campaign_status as enum ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled');
create type public.window_policy as enum ('standard_24h', 'human_agent_7d', 'blocked');

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  timezone text not null default 'America/Sao_Paulo',
  knowledge_base text not null default '',
  plan text not null default 'mvp',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'agent',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed public.workspace_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = any(allowed)
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.has_workspace_role(uuid, public.workspace_role[]) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated, service_role;

create table public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_user_id text not null,
  username text not null,
  display_name text,
  profile_picture_url text,
  page_id text,
  status text not null default 'connected' check (status in ('connected', 'expired', 'disconnected')),
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  webhook_subscribed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, instagram_user_id)
);

create table private.instagram_credentials (
  instagram_account_id uuid primary key references public.instagram_accounts(id) on delete cascade,
  access_token_encrypted text not null,
  publish_token_encrypted text,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid references public.instagram_accounts(id) on delete set null,
  instagram_user_id text not null,
  username text,
  full_name text,
  avatar_url text,
  email text,
  phone text,
  inbox_category text not null default 'principal' check (inbox_category in ('principal', 'geral', 'pedidos', 'ia_off')),
  ai_enabled boolean not null default true,
  opted_out_at timestamptz,
  last_interaction_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  first_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, instagram_user_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#111111' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_automatic boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, name)
);

create table public.contact_tags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (contact_id, tag_id)
);

create table public.posts_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid references public.instagram_accounts(id) on delete cascade,
  instagram_media_id text not null,
  kind public.content_kind not null default 'feed',
  caption text,
  permalink text,
  media_url text,
  thumbnail_url text,
  published_at timestamptz,
  reach integer not null default 0 check (reach >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  likes integer not null default 0 check (likes >= 0),
  comments integer not null default 0 check (comments >= 0),
  saves integer not null default 0 check (saves >= 0),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, instagram_media_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid references public.instagram_accounts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  category text not null default 'principal' check (category in ('principal', 'geral', 'pedidos', 'ia_off')),
  unread_count integer not null default 0 check (unread_count >= 0),
  assigned_to uuid references auth.users(id) on delete set null,
  last_message_preview text,
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, contact_id, instagram_account_id)
);

create table public.interactions_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid references public.instagram_accounts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  meta_event_id text,
  channel public.interaction_channel not null,
  direction public.interaction_direction not null,
  message_text text,
  media_url text,
  status public.message_status not null default 'sent',
  is_automated boolean not null default false,
  policy_used public.window_policy,
  block_reason text,
  meta_created_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  interaction_id uuid references public.interactions_log(id) on delete set null,
  direction public.interaction_direction not null,
  body text,
  media_url text,
  status public.message_status not null default 'queued',
  is_ai_generated boolean not null default false,
  is_automated boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, name)
);

create table public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  position integer not null check (position >= 0),
  kind public.sequence_step_kind not null,
  content text,
  media_url text,
  delay_seconds integer not null default 0 check (delay_seconds between 0 and 604800),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (sequence_id, position)
);

create table public.triggers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  source public.trigger_source not null,
  keyword text not null,
  match_mode public.match_mode not null default 'contains',
  post_id uuid references public.posts_cache(id) on delete set null,
  response_text text,
  sequence_id uuid references public.sequences(id) on delete set null,
  auto_tag_id uuid references public.tags(id) on delete set null,
  is_active boolean not null default true,
  cooldown_hours integer not null default 24 check (cooldown_hours between 1 and 168),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((response_text is not null) <> (sequence_id is not null))
);

create table public.trigger_cooldowns (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trigger_id uuid not null references public.triggers(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  last_fired_at timestamptz not null default timezone('utc', now()),
  primary key (trigger_id, contact_id)
);

create table public.comment_private_replies (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_comment_id text primary key,
  contact_id uuid references public.contacts(id) on delete set null,
  interaction_id uuid references public.interactions_log(id) on delete set null,
  replied_at timestamptz not null default timezone('utc', now())
);

create table public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  current_position integer not null default 0,
  status text not null default 'active' check (status in ('active', 'completed', 'paused', 'cancelled', 'blocked')),
  next_run_at timestamptz,
  blocked_reason text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('sequence_step', 'campaign_message', 'content_publish', 'insights_sync')),
  payload jsonb not null,
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'blocked')),
  attempts integer not null default 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  meta_event_key text not null unique,
  instagram_user_id text,
  payload jsonb not null,
  signature_valid boolean not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create table public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  persona text not null,
  mode public.ai_agent_mode not null default 'copilot',
  tone text not null default 'próximo, útil e brasileiro',
  temperature numeric(3,2) not null default 0.6 check (temperature between 0 and 1),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, name)
);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ai_agent_id uuid references public.ai_agents(id) on delete cascade,
  title text not null,
  content text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  message text not null,
  status public.campaign_status not null default 'draft',
  eligibility_mode public.window_policy not null default 'standard_24h',
  rate_per_minute integer not null default 35 check (rate_per_minute between 30 and 45),
  filters jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  eligibility public.window_policy not null,
  status public.message_status not null default 'queued',
  reason text,
  sent_at timestamptz,
  unique (campaign_id, contact_id)
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid references public.instagram_accounts(id) on delete set null,
  kind public.content_kind not null,
  title text not null,
  caption text,
  script text,
  media jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('idea', 'draft', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  meta_container_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.insights_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instagram_account_id uuid references public.instagram_accounts(id) on delete cascade,
  day date not null,
  reach integer not null default 0,
  impressions integer not null default 0,
  followers integer not null default 0,
  dms_received integer not null default 0,
  dms_sent integer not null default 0,
  comments integer not null default 0,
  new_contacts integer not null default 0,
  hourly_activity jsonb not null default '{}'::jsonb,
  primary key (workspace_id, day)
);

create table public.blocklist_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  term text not null,
  kind text not null default 'spam' check (kind in ('spam', 'palavrao', 'manual')),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, term)
);

create index contacts_workspace_last_interaction_idx on public.contacts (workspace_id, last_interaction_at desc);
create index interactions_workspace_created_idx on public.interactions_log (workspace_id, created_at desc);
create index interactions_contact_created_idx on public.interactions_log (contact_id, created_at desc);
create unique index interactions_meta_event_unique_idx on public.interactions_log (workspace_id, meta_event_id) where meta_event_id is not null;
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index scheduled_jobs_due_idx on public.scheduled_jobs (run_at) where status = 'pending';
create index triggers_match_idx on public.triggers (workspace_id, source, is_active);
create index posts_cache_published_idx on public.posts_cache (workspace_id, published_at desc);

-- Views usam os privilégios do chamador para não contornar as policies das tabelas-base.
create or replace view public.dashboard_last_7_days with (security_invoker = true) as
select
  w.id as workspace_id,
  coalesce(sum(i.reach), 0)::bigint as accounts_reached,
  coalesce(sum(i.dms_received), 0)::bigint as dms_received,
  coalesce(sum(i.dms_sent), 0)::bigint as dms_sent,
  coalesce(sum(i.comments), 0)::bigint as comments,
  coalesce(sum(i.new_contacts), 0)::bigint as new_contacts
from public.workspaces w
left join public.insights_daily i on i.workspace_id = w.id and i.day >= current_date - 6
group by w.id;

create or replace view public.contact_messaging_eligibility with (security_invoker = true) as
select
  c.id as contact_id,
  c.workspace_id,
  c.opted_out_at,
  c.last_inbound_at,
  case
    when c.opted_out_at is not null then 'blocked'::public.window_policy
    when c.last_inbound_at > timezone('utc', now()) - interval '24 hours' then 'standard_24h'::public.window_policy
    when c.last_inbound_at > timezone('utc', now()) - interval '7 days' then 'human_agent_7d'::public.window_policy
    else 'blocked'::public.window_policy
  end as eligibility,
  greatest(0, extract(epoch from (c.last_inbound_at + interval '24 hours' - timezone('utc', now())))::integer) as seconds_left_24h
from public.contacts c;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  new_workspace_id uuid;
  base_slug text;
begin
  base_slug := lower(regexp_replace(split_part(coalesce(new.email, 'wal'), '@', 1), '[^a-z0-9]+', '-', 'g'));
  insert into public.workspaces (owner_id, name, slug)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', 'Meu Wal Chat'), trim(both '-' from base_slug) || '-' || substr(new.id::text, 1, 6))
  returning id into new_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'workspaces','instagram_accounts','contacts','tags','posts_cache','conversations',
    'sequences','sequence_steps','triggers','sequence_enrollments','scheduled_jobs',
    'ai_agents','knowledge_documents','campaigns','content_items','blocklist_entries'
  ] loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute procedure public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

-- RLS é obrigatório em toda entidade acessível pelo cliente autenticado.
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.instagram_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;
alter table public.posts_cache enable row level security;
alter table public.conversations enable row level security;
alter table public.interactions_log enable row level security;
alter table public.messages enable row level security;
alter table public.sequences enable row level security;
alter table public.sequence_steps enable row level security;
alter table public.triggers enable row level security;
alter table public.trigger_cooldowns enable row level security;
alter table public.comment_private_replies enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.scheduled_jobs enable row level security;
alter table public.webhook_events enable row level security;
alter table public.ai_agents enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.content_items enable row level security;
alter table public.insights_daily enable row level security;
alter table public.blocklist_entries enable row level security;

create policy workspace_select on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy workspace_update on public.workspaces for update to authenticated using (public.has_workspace_role(id, array['owner','admin']::public.workspace_role[])) with check (public.has_workspace_role(id, array['owner','admin']::public.workspace_role[]));
create policy members_select on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy members_manage on public.workspace_members for all to authenticated using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])) with check (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'instagram_accounts','contacts','tags','contact_tags','posts_cache','conversations',
    'interactions_log','messages','sequences','sequence_steps','triggers','trigger_cooldowns',
    'comment_private_replies','sequence_enrollments','scheduled_jobs','ai_agents','knowledge_documents',
    'campaigns','campaign_recipients','content_items','insights_daily','blocklist_entries'
  ] loop
    execute format('create policy tenant_select on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', table_name);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check (public.is_workspace_member(workspace_id))', table_name);
    execute format('create policy tenant_update on public.%I for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', table_name);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using (public.is_workspace_member(workspace_id))', table_name);
  end loop;
end $$;

-- Webhooks são escritos apenas pelo backend com service_role.
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.webhook_events from authenticated;
grant select on public.dashboard_last_7_days, public.contact_messaging_eligibility to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all tables in schema private to service_role;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;

comment on table public.comment_private_replies is 'Chave única por comentário garante no máximo uma Private Reply automática.';
comment on table public.trigger_cooldowns is 'Cooldown anti-spam por contato e gatilho; o worker aplica 24h por padrão.';
comment on view public.contact_messaging_eligibility is 'Fonte única para janela padrão de 24h, HUMAN_AGENT 7d ou bloqueio.';
