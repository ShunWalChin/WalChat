-- Wal Chat - calendario operacional, Google Calendar/Tasks e agendamentos.
-- Tokens OAuth permanecem cifrados em integration_credentials; nenhuma tabela
-- exposta aos clientes guarda access_token ou refresh_token.

alter table public.integration_credentials
  drop constraint if exists integration_credentials_credential_type_check;
alter table public.integration_credentials
  add constraint integration_credentials_credential_type_check
  check (credential_type in ('access_token', 'refresh_token', 'api_key'));

alter table public.integration_oauth_states
  drop constraint if exists integration_oauth_states_provider_check;
alter table public.integration_oauth_states
  add constraint integration_oauth_states_provider_check
  check (provider in ('meta', 'google'));

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  provider_account_id text,
  account_email text,
  display_name text,
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'error', 'disconnected')),
  scopes text[] not null default '{}',
  selected_calendar_id text not null default 'primary',
  selected_calendar_name text,
  selected_tasklist_id text,
  available_calendars jsonb not null default '[]'::jsonb
    check (jsonb_typeof(available_calendars) = 'array'),
  available_tasklists jsonb not null default '[]'::jsonb
    check (jsonb_typeof(available_tasklists) = 'array'),
  sync_token text,
  last_sync_at timestamptz,
  connection_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, user_id, provider)
);

create table public.booking_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  calendar_connection_id uuid references public.calendar_connections(id) on delete set null,
  calendar_id text not null default 'primary',
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  title text not null check (char_length(title) between 2 and 120),
  description text check (description is null or char_length(description) <= 1000),
  duration_minutes integer not null default 30 check (duration_minutes between 15 and 240),
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) <= 80),
  availability jsonb not null default '{"1":[{"start":"09:00","end":"18:00"}],"2":[{"start":"09:00","end":"18:00"}],"3":[{"start":"09:00","end":"18:00"}],"4":[{"start":"09:00","end":"18:00"}],"5":[{"start":"09:00","end":"18:00"}]}'::jsonb
    check (jsonb_typeof(availability) = 'object'),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 120),
  buffer_after_minutes integer not null default 15 check (buffer_after_minutes between 0 and 120),
  minimum_notice_minutes integer not null default 120 check (minimum_notice_minutes between 0 and 43200),
  max_advance_days integer not null default 60 check (max_advance_days between 1 and 365),
  create_meet boolean not null default true,
  require_phone boolean not null default false,
  confirmation_message text check (confirmation_message is null or char_length(confirmation_message) <= 1000),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  booking_page_id uuid not null references public.booking_pages(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  guest_name text not null check (char_length(guest_name) between 2 and 120),
  guest_email text not null check (char_length(guest_email) between 3 and 254),
  guest_phone text check (guest_phone is null or char_length(guest_phone) <= 30),
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null check (char_length(timezone) <= 80),
  status text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  source text not null default 'public_page'
    check (source in ('public_page', 'ai_agent', 'trigger', 'sequence', 'manual')),
  notes text check (notes is null or char_length(notes) <= 2000),
  meet_url text,
  google_event_id text,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_at > start_at),
  unique (workspace_id, idempotency_key)
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  calendar_connection_id uuid references public.calendar_connections(id) on delete set null,
  provider text not null default 'local' check (provider in ('local', 'google', 'system')),
  provider_event_id text,
  calendar_id text,
  event_type text not null default 'event'
    check (event_type in ('event', 'meeting', 'content', 'campaign', 'sequence', 'booking', 'system')),
  title text not null check (char_length(title) between 1 and 180),
  description text check (description is null or char_length(description) <= 8000),
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) <= 80),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'tentative', 'cancelled', 'sync_pending', 'sync_error')),
  location text check (location is null or char_length(location) <= 500),
  meet_url text,
  html_link text,
  attendees jsonb not null default '[]'::jsonb check (jsonb_typeof(attendees) = 'array'),
  reminders jsonb not null default '{}'::jsonb check (jsonb_typeof(reminders) = 'object'),
  contact_id uuid references public.contacts(id) on delete set null,
  content_item_id uuid references public.content_items(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  sequence_enrollment_id uuid references public.sequence_enrollments(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_at > start_at),
  unique (calendar_connection_id, provider_event_id)
);

alter table public.bookings
  add column calendar_event_id uuid references public.calendar_events(id) on delete set null;

create table public.calendar_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  calendar_connection_id uuid references public.calendar_connections(id) on delete set null,
  provider text not null default 'local' check (provider in ('local', 'google')),
  provider_task_id text,
  tasklist_id text,
  title text not null check (char_length(title) between 1 and 180),
  notes text check (notes is null or char_length(notes) <= 8000),
  due_at timestamptz,
  completed_at timestamptz,
  status text not null default 'needs_action'
    check (status in ('needs_action', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  sync_status text not null default 'local' check (sync_status in ('local', 'pending', 'synced', 'error')),
  sync_error text,
  contact_id uuid references public.contacts(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (calendar_connection_id, provider_task_id)
);

create table public.calendar_activities (
  id bigint generated by default as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null check (char_length(source_type) between 1 and 80),
  source_id text,
  action text not null check (char_length(action) between 1 and 120),
  title text not null check (char_length(title) between 1 and 240),
  description text,
  happened_at timestamptz not null default timezone('utc', now()),
  contact_id uuid references public.contacts(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.ai_agents
  add column if not exists booking_page_id uuid references public.booking_pages(id) on delete set null;
alter table public.triggers
  add column if not exists booking_page_id uuid references public.booking_pages(id) on delete set null;

create index calendar_connections_workspace_idx on public.calendar_connections (workspace_id, status);
create index booking_pages_workspace_idx on public.booking_pages (workspace_id, is_active);
create index bookings_workspace_start_idx on public.bookings (workspace_id, start_at, status);
create unique index bookings_active_slot_unique on public.bookings (booking_page_id, start_at)
  where status in ('pending', 'confirmed');
create index calendar_events_workspace_range_idx on public.calendar_events (workspace_id, start_at, end_at);
create unique index calendar_events_booking_unique on public.calendar_events (booking_id)
  where booking_id is not null;
create index calendar_events_contact_idx on public.calendar_events (contact_id, start_at desc) where contact_id is not null;
create index calendar_tasks_workspace_due_idx on public.calendar_tasks (workspace_id, due_at) where due_at is not null;
create index calendar_activities_workspace_time_idx on public.calendar_activities (workspace_id, happened_at desc);
create index calendar_activities_source_idx on public.calendar_activities (workspace_id, source_type, source_id);

create trigger set_calendar_connections_updated_at before update on public.calendar_connections
  for each row execute procedure public.set_updated_at();
create trigger set_booking_pages_updated_at before update on public.booking_pages
  for each row execute procedure public.set_updated_at();
create trigger set_bookings_updated_at before update on public.bookings
  for each row execute procedure public.set_updated_at();
create trigger set_calendar_events_updated_at before update on public.calendar_events
  for each row execute procedure public.set_updated_at();
create trigger set_calendar_tasks_updated_at before update on public.calendar_tasks
  for each row execute procedure public.set_updated_at();

-- Reserva transacional: o lock por página elimina duas confirmações simultâneas.
create or replace function public.reserve_calendar_booking(
  target_booking_page_id uuid,
  target_contact_id uuid,
  target_guest_name text,
  target_guest_email text,
  target_guest_phone text,
  target_start_at timestamptz,
  target_end_at timestamptz,
  target_timezone text,
  target_source text,
  target_notes text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  page_row public.booking_pages%rowtype;
  booking_id uuid;
  event_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_booking_page_id::text, 0));
  select * into page_row from public.booking_pages
    where id = target_booking_page_id and is_active = true;
  if not found then raise exception 'booking_page_unavailable'; end if;
  select booking.id into booking_id from public.bookings booking
    where booking.workspace_id = page_row.workspace_id
      and booking.idempotency_key = target_idempotency_key;
  if found then return booking_id; end if;
  if target_end_at <= target_start_at then raise exception 'invalid_booking_range'; end if;
  if exists (
    select 1 from public.bookings booking
    where booking.booking_page_id = target_booking_page_id
      and booking.status in ('pending', 'confirmed')
      and tstzrange(
        booking.start_at - make_interval(mins => page_row.buffer_before_minutes),
        booking.end_at + make_interval(mins => page_row.buffer_after_minutes),
        '[)'
      ) && tstzrange(
        target_start_at - make_interval(mins => page_row.buffer_before_minutes),
        target_end_at + make_interval(mins => page_row.buffer_after_minutes),
        '[)'
      )
  ) then raise exception 'booking_slot_unavailable'; end if;
  insert into public.bookings (
    workspace_id, booking_page_id, contact_id, guest_name, guest_email,
    guest_phone, start_at, end_at, timezone, source, notes, idempotency_key
  ) values (
    page_row.workspace_id, target_booking_page_id, target_contact_id,
    target_guest_name, lower(target_guest_email), target_guest_phone,
    target_start_at, target_end_at, target_timezone, target_source,
    target_notes, target_idempotency_key
  ) returning id into booking_id;
  insert into public.calendar_events (
    workspace_id, calendar_connection_id, provider, calendar_id, event_type,
    title, description, start_at, end_at, timezone, status, attendees,
    contact_id, booking_id, metadata
  ) values (
    page_row.workspace_id, page_row.calendar_connection_id,
    case when page_row.calendar_connection_id is null then 'local' else 'google' end,
    page_row.calendar_id, 'booking', page_row.title || ' · ' || target_guest_name,
    coalesce(target_notes, 'Agendamento recebido por ' || page_row.slug),
    target_start_at, target_end_at, target_timezone,
    case when page_row.calendar_connection_id is null then 'confirmed' else 'sync_pending' end,
    jsonb_build_array(jsonb_build_object('email', lower(target_guest_email), 'displayName', target_guest_name)),
    target_contact_id, booking_id,
    jsonb_build_object('source', target_source, 'createMeet', page_row.create_meet)
  ) returning id into event_id;
  update public.bookings set calendar_event_id = event_id where id = booking_id;
  return booking_id;
end;
$$;

revoke all on function public.reserve_calendar_booking(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text,text,text) from public, anon, authenticated;
grant execute on function public.reserve_calendar_booking(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text,text,text) to service_role;

-- Auditoria temporal automática das principais ações do produto. O JSONB
-- evita acoplamento a colunas específicas e registra somente metadados seguros.
create or replace function public.record_wal_calendar_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data jsonb := to_jsonb(new);
  workspace uuid;
  source_id_value text;
  action_value text;
  title_value text;
  happened timestamptz;
begin
  workspace := nullif(row_data->>'workspace_id', '')::uuid;
  if workspace is null then return new; end if;
  source_id_value := coalesce(row_data->>'id', row_data->>'state_hash');
  action_value := lower(tg_op) || coalesce(':' || nullif(row_data->>'status', ''), '');
  title_value := coalesce(
    nullif(row_data->>'title', ''), nullif(row_data->>'name', ''),
    nullif(row_data->>'action', ''), replace(tg_table_name, '_', ' ')
  );
  happened := coalesce(
    nullif(row_data->>'published_at', '')::timestamptz,
    nullif(row_data->>'scheduled_at', '')::timestamptz,
    nullif(row_data->>'run_at', '')::timestamptz,
    nullif(row_data->>'next_run_at', '')::timestamptz,
    nullif(row_data->>'meta_created_at', '')::timestamptz,
    nullif(row_data->>'created_at', '')::timestamptz,
    timezone('utc', now())
  );
  insert into public.calendar_activities (
    workspace_id, source_type, source_id, action, title, happened_at,
    contact_id, actor_user_id, metadata
  ) values (
    workspace, tg_table_name, source_id_value, action_value,
    left(title_value, 240), happened,
    nullif(row_data->>'contact_id', '')::uuid,
    coalesce(nullif(row_data->>'actor_user_id', '')::uuid, nullif(row_data->>'created_by', '')::uuid),
    jsonb_build_object('status', row_data->>'status')
  );
  return new;
end;
$$;

revoke all on function public.record_wal_calendar_activity() from public, anon, authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'contacts','contact_notes','triggers','sequences','sequence_enrollments',
    'scheduled_jobs','ai_agents','campaigns','content_items','interactions_log',
    'integration_audit_logs','bookings'
  ] loop
    execute format('drop trigger if exists record_calendar_activity on public.%I', table_name);
    execute format(
      'create trigger record_calendar_activity after insert or update on public.%I for each row execute procedure public.record_wal_calendar_activity()',
      table_name
    );
  end loop;
end $$;

alter table public.calendar_connections enable row level security;
alter table public.booking_pages enable row level security;
alter table public.bookings enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_tasks enable row level security;
alter table public.calendar_activities enable row level security;

create policy calendar_connections_select on public.calendar_connections for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy calendar_connections_manage on public.calendar_connections for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy booking_pages_select on public.booking_pages for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy booking_pages_manage on public.booking_pages for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]));
create policy bookings_select on public.bookings for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy bookings_manage on public.bookings for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]));
create policy calendar_events_select on public.calendar_events for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy calendar_events_manage on public.calendar_events for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]));
create policy calendar_tasks_select on public.calendar_tasks for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy calendar_tasks_manage on public.calendar_tasks for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin','agent']::public.workspace_role[]));
create policy calendar_activities_select on public.calendar_activities for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.calendar_connections, public.booking_pages, public.bookings,
  public.calendar_events, public.calendar_tasks, public.calendar_activities from anon;
grant select on public.calendar_connections, public.booking_pages, public.bookings,
  public.calendar_events, public.calendar_tasks, public.calendar_activities to authenticated;
grant insert, update, delete on public.calendar_connections to authenticated;
grant insert, update, delete on public.booking_pages, public.bookings,
  public.calendar_events, public.calendar_tasks to authenticated;
revoke insert, update, delete on public.calendar_activities from authenticated;
grant all on public.calendar_connections, public.booking_pages, public.bookings,
  public.calendar_events, public.calendar_tasks, public.calendar_activities to service_role;
grant usage, select on sequence public.calendar_activities_id_seq to service_role;

comment on table public.calendar_connections is 'Conexões Google por tenant; tokens ficam cifrados fora desta tabela.';
comment on table public.calendar_events is 'Eventos locais, Google, reuniões Meet e projeções operacionais do Wal Chat.';
comment on table public.calendar_tasks is 'Tarefas locais e sincronizadas com Google Tasks.';
comment on table public.booking_pages is 'Páginas públicas de disponibilidade usadas por pessoas, fluxos e agentes de IA.';
comment on table public.calendar_activities is 'Linha do tempo imutável das principais ações do produto.';
