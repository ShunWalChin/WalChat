-- Claims at-most-once para evitar DMs duplicadas após timeout ou retry.
create table public.outbound_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  source text not null check (source in ('manual', 'scheduled')),
  scheduled_job_id uuid references public.scheduled_jobs(id) on delete set null,
  instagram_account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  recipient_id text not null,
  message_body text not null,
  policy_used public.window_policy not null,
  decision_reason text,
  requested_tag text,
  seconds_left_24h integer not null default 0 check (seconds_left_24h >= 0),
  status text not null check (status in ('claimed', 'sent', 'blocked', 'unknown')),
  provider_message_id text,
  last_error_code text,
  claimed_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, idempotency_key)
);

create index outbound_deliveries_workspace_created_idx
  on public.outbound_deliveries (workspace_id, created_at desc);

create index outbound_deliveries_unknown_idx
  on public.outbound_deliveries (created_at)
  where status = 'unknown';

alter table public.interactions_log
  add column outbound_delivery_id uuid
  references public.outbound_deliveries(id) on delete set null;

create unique index interactions_outbound_delivery_unique_idx
  on public.interactions_log (outbound_delivery_id)
  where outbound_delivery_id is not null;

alter table public.outbound_deliveries enable row level security;

create trigger set_outbound_deliveries_updated_at
  before update on public.outbound_deliveries
  for each row execute procedure public.set_updated_at();

-- Claims contêm corpo e destinatário; somente o backend privilegiado acessa.
revoke all on public.outbound_deliveries from anon, authenticated;
grant all on public.outbound_deliveries to service_role;

comment on table public.outbound_deliveries is
  'Claim at-most-once de DMs Meta; status unknown proíbe retry automático.';

comment on column public.outbound_deliveries.idempotency_key is
  'Chave opaca fornecida pelo cliente ou derivada do scheduled job.';
