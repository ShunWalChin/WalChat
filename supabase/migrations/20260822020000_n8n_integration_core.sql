-- Wal Chat — conexões n8n multi-tenant, entregas idempotentes e vínculos CRM.

alter table public.integration_credentials
  drop constraint if exists integration_credentials_provider_check;
alter table public.integration_credentials
  add constraint integration_credentials_provider_check
  check (provider in ('meta', 'openai', 'google', 'n8n'));

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider = 'n8n'),
  name text not null default 'n8n principal'
    check (char_length(name) between 2 and 80),
  base_url text not null check (char_length(base_url) between 8 and 2048),
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'error', 'disconnected')),
  detected_version text,
  event_subscriptions text[] not null default array[
    'contact.created', 'contact.updated', 'message.received',
    'booking.created', 'automation.completed'
  ]::text[],
  last_validated_at timestamptz,
  last_event_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, provider)
);

create table public.integration_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  delivery_id text not null check (char_length(delivery_id) between 8 and 128),
  event_type text not null check (char_length(event_type) between 2 and 100),
  status text not null default 'received'
    check (status in ('received', 'processing', 'completed', 'failed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  http_status smallint check (http_status is null or http_status between 100 and 599),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (connection_id, direction, delivery_id)
);

create table public.integration_contact_links (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  provider text not null check (provider = 'n8n'),
  external_id text not null check (char_length(external_id) between 1 and 160),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (connection_id, external_id),
  unique (connection_id, contact_id)
);

create index integration_connections_workspace_status_idx
  on public.integration_connections (workspace_id, status);
create index integration_deliveries_workspace_created_idx
  on public.integration_webhook_deliveries (workspace_id, created_at desc);
create index integration_deliveries_connection_status_idx
  on public.integration_webhook_deliveries (connection_id, status, created_at);
create index integration_contact_links_contact_idx
  on public.integration_contact_links (workspace_id, contact_id);

create trigger set_integration_connections_updated_at
  before update on public.integration_connections
  for each row execute procedure public.set_updated_at();
create trigger set_integration_contact_links_updated_at
  before update on public.integration_contact_links
  for each row execute procedure public.set_updated_at();

alter table public.integration_connections enable row level security;
alter table public.integration_webhook_deliveries enable row level security;
alter table public.integration_contact_links enable row level security;

-- As conexões e segredos são expostos somente por APIs server-side sanitizadas.
revoke all on public.integration_connections from anon, authenticated;
revoke all on public.integration_webhook_deliveries from anon, authenticated;
revoke all on public.integration_contact_links from anon, authenticated;
grant all on public.integration_connections to service_role;
grant all on public.integration_webhook_deliveries to service_role;
grant all on public.integration_contact_links to service_role;

comment on table public.integration_connections is
  'Conectores externos por workspace; URLs completas nunca são devolvidas ao navegador.';
comment on table public.integration_webhook_deliveries is
  'Inbox/outbox idempotente e observável dos eventos de integrações externas.';
comment on table public.integration_contact_links is
  'Identidade externa estável ligada a um contato do CRM do mesmo workspace.';

-- Eventos de negócio entram na mesma fila durável do scheduler. O trigger não
-- executa rede nem atrasa o commit do domínio.
alter table public.scheduled_jobs
  drop constraint if exists scheduled_jobs_kind_check;
alter table public.scheduled_jobs
  add constraint scheduled_jobs_kind_check
  check (kind in (
    'sequence_step', 'automation_step', 'integration_event',
    'campaign_message', 'content_publish', 'insights_sync'
  ));

create or replace function private.enqueue_n8n_integration_event(
  target_workspace_id uuid,
  target_event_type text,
  target_dedupe_key text,
  target_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_id uuid;
  delivery_id uuid := extensions.gen_random_uuid();
begin
  select connection.id into connection_id
  from public.integration_connections connection
  where connection.workspace_id = target_workspace_id
    and connection.provider = 'n8n'
    and connection.status = 'connected'
    and target_event_type = any(connection.event_subscriptions)
  limit 1;

  if connection_id is null then return; end if;

  insert into public.scheduled_jobs (
    workspace_id, kind, dedupe_key, payload, run_at
  ) values (
    target_workspace_id,
    'integration_event',
    target_dedupe_key,
    jsonb_build_object(
      'connectionId', connection_id,
      'deliveryId', delivery_id,
      'eventType', target_event_type,
      'eventData', target_payload
    ),
    timezone('utc', now())
  )
  on conflict (workspace_id, dedupe_key) do nothing;
end;
$$;

revoke all on function private.enqueue_n8n_integration_event(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function private.enqueue_n8n_integration_event(uuid,text,text,jsonb)
  to service_role;

create or replace function public.queue_n8n_contact_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.import_source is distinct from 'n8n' then
    perform private.enqueue_n8n_integration_event(
      new.workspace_id,
      'contact.created',
      'integration:contact.created:' || new.id::text,
      jsonb_build_object(
        'contactId', new.id,
        'platform', new.platform,
        'email', new.email,
        'phone', new.phone,
        'lifecycleStage', new.lifecycle_stage
      )
    );
  end if;
  return new;
end;
$$;

create or replace function public.queue_n8n_message_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction::text = 'inbound' then
    perform private.enqueue_n8n_integration_event(
      new.workspace_id,
      'message.received',
      'integration:message.received:' || new.id::text,
      jsonb_build_object(
        'messageId', new.id,
        'contactId', new.contact_id,
        'conversationId', new.conversation_id,
        'platform', new.platform,
        'body', new.body,
        'mediaUrl', new.media_url
      )
    );
  end if;
  return new;
end;
$$;

create or replace function public.queue_n8n_booking_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_n8n_integration_event(
    new.workspace_id,
    'booking.created',
    'integration:booking.created:' || new.id::text,
    jsonb_build_object(
      'bookingId', new.id,
      'contactId', new.contact_id,
      'startAt', new.start_at,
      'endAt', new.end_at,
      'status', new.status,
      'source', new.source
    )
  );
  return new;
end;
$$;

create or replace function public.queue_n8n_automation_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    perform private.enqueue_n8n_integration_event(
      new.workspace_id,
      'automation.completed',
      'integration:automation.completed:' || new.id::text,
      jsonb_build_object(
        'executionId', new.id,
        'flowId', new.flow_id,
        'contactId', new.contact_id,
        'platform', new.platform,
        'completedAt', new.completed_at
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.queue_n8n_contact_created() from public, anon, authenticated;
revoke all on function public.queue_n8n_message_received() from public, anon, authenticated;
revoke all on function public.queue_n8n_booking_created() from public, anon, authenticated;
revoke all on function public.queue_n8n_automation_completed() from public, anon, authenticated;

create trigger queue_contact_created_to_n8n
  after insert on public.contacts
  for each row execute procedure public.queue_n8n_contact_created();
create trigger queue_message_received_to_n8n
  after insert on public.messages
  for each row execute procedure public.queue_n8n_message_received();
create trigger queue_booking_created_to_n8n
  after insert on public.bookings
  for each row execute procedure public.queue_n8n_booking_created();
create trigger queue_automation_completed_to_n8n
  after update of status on public.automation_executions
  for each row execute procedure public.queue_n8n_automation_completed();
