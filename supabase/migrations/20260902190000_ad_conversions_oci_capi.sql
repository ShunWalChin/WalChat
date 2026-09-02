-- Wal Chat — rastreamento de conversões offline Google Ads + Meta CAPI.
-- A mudança de etapa apenas cria um evento durável. Chamadas externas ficam no
-- scheduler para não aumentar a latência nem fragilizar a transação do CRM.

alter table public.integration_credentials
  drop constraint if exists integration_credentials_provider_check;
alter table public.integration_credentials
  add constraint integration_credentials_provider_check
  check (provider in ('meta', 'openai', 'google', 'n8n', 'google_ads', 'meta_capi'));

alter table public.scheduled_jobs
  drop constraint if exists scheduled_jobs_kind_check;
alter table public.scheduled_jobs
  add constraint scheduled_jobs_kind_check
  check (kind in (
    'sequence_step', 'automation_step', 'integration_event',
    'automation_await_timeout', 'ad_conversion',
    'campaign_message', 'content_publish', 'insights_sync'
  ));

update public.integration_connections
set event_subscriptions = array_append(event_subscriptions, 'conversion.ready')
where provider = 'n8n'
  and not ('conversion.ready' = any(event_subscriptions));

create table public.contact_ad_attributions (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  gclid text check (gclid is null or char_length(gclid) between 1 and 512),
  gbraid text check (gbraid is null or char_length(gbraid) between 1 and 512),
  wbraid text check (wbraid is null or char_length(wbraid) between 1 and 512),
  fbclid text check (fbclid is null or char_length(fbclid) between 1 and 512),
  fbc text check (fbc is null or char_length(fbc) between 1 and 512),
  fbp text check (fbp is null or char_length(fbp) between 1 and 512),
  utm_source text check (utm_source is null or char_length(utm_source) <= 160),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 160),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 240),
  utm_content text check (utm_content is null or char_length(utm_content) <= 240),
  utm_term text check (utm_term is null or char_length(utm_term) <= 240),
  landing_url text check (landing_url is null or char_length(landing_url) <= 2048),
  referrer_url text check (referrer_url is null or char_length(referrer_url) <= 2048),
  client_user_agent text check (client_user_agent is null or char_length(client_user_agent) <= 512),
  ad_user_data_consent text not null default 'unknown'
    check (ad_user_data_consent in ('unknown', 'granted', 'denied')),
  first_touch_at timestamptz not null default timezone('utc', now()),
  last_touch_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '90 days'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (contact_id, workspace_id)
);

create table public.ad_conversion_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('google_ads', 'meta_capi')),
  delivery_mode text not null default 'direct' check (delivery_mode in ('direct', 'n8n')),
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'error', 'disconnected')),
  account_id text not null default '' check (char_length(account_id) <= 80),
  manager_account_id text check (manager_account_id is null or char_length(manager_account_id) <= 80),
  account_email text check (account_email is null or char_length(account_email) <= 254),
  api_version text not null default 'v25' check (api_version ~ '^v[0-9]+$'),
  default_currency text not null default 'BRL' check (default_currency ~ '^[A-Z]{3}$'),
  last_validated_at timestamptz,
  last_event_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 240),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, provider)
);

create table public.ad_conversion_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stage_id uuid not null,
  name text not null check (char_length(name) between 2 and 120),
  google_enabled boolean not null default false,
  google_conversion_action_id text
    check (google_conversion_action_id is null or google_conversion_action_id ~ '^[0-9]{1,30}$'),
  meta_enabled boolean not null default false,
  meta_event_name text check (meta_event_name is null or char_length(meta_event_name) between 1 and 100),
  meta_action_source text not null default 'system_generated'
    check (meta_action_source in ('website','app','phone_call','chat','email','other','physical_store','system_generated')),
  value_mode text not null default 'lead' check (value_mode in ('lead','fixed','none')),
  fixed_value_cents bigint check (fixed_value_cents is null or fixed_value_cents >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  require_consent boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, stage_id),
  unique (id, workspace_id),
  foreign key (stage_id, workspace_id)
    references public.crm_stages(id, workspace_id) on delete cascade,
  check (google_enabled or meta_enabled),
  check (not google_enabled or google_conversion_action_id is not null),
  check (not meta_enabled or meta_event_name is not null),
  check (value_mode <> 'fixed' or fixed_value_cents is not null)
);

create table public.ad_conversion_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_id uuid not null,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  stage_id uuid not null,
  event_name text not null check (char_length(event_name) between 1 and 120),
  value_cents bigint check (value_cents is null or value_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending'
    check (status in ('pending','processing','completed','partial','failed','blocked')),
  provider_results jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  event_time timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (rule_id, lead_id),
  foreign key (rule_id, workspace_id)
    references public.ad_conversion_rules(id, workspace_id) on delete cascade,
  foreign key (stage_id, workspace_id)
    references public.crm_stages(id, workspace_id) on delete cascade
);

create table public.ad_conversion_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_id uuid not null references public.ad_conversion_events(id) on delete cascade,
  provider text not null check (provider in ('google_ads','meta_capi','n8n')),
  attempt integer not null check (attempt >= 1),
  status text not null check (status in ('completed','failed','retrying','skipped')),
  http_status smallint check (http_status is null or http_status between 100 and 599),
  request_id text check (request_id is null or char_length(request_id) <= 160),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  response_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (event_id, provider, attempt)
);

create index contact_ad_attributions_workspace_idx
  on public.contact_ad_attributions (workspace_id, last_touch_at desc);
create index ad_conversion_rules_workspace_active_idx
  on public.ad_conversion_rules (workspace_id, stage_id) where is_active;
create index ad_conversion_events_workspace_status_idx
  on public.ad_conversion_events (workspace_id, status, created_at desc);
create index ad_conversion_deliveries_event_idx
  on public.ad_conversion_deliveries (event_id, created_at desc);

create or replace function private.preserve_ad_attribution_touches()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.gclid := coalesce(old.gclid, new.gclid);
  new.gbraid := coalesce(old.gbraid, new.gbraid);
  new.wbraid := coalesce(old.wbraid, new.wbraid);
  new.fbclid := coalesce(old.fbclid, new.fbclid);
  new.fbc := coalesce(old.fbc, new.fbc);
  new.fbp := coalesce(old.fbp, new.fbp);
  new.first_touch_at := least(old.first_touch_at, new.first_touch_at);
  new.expires_at := greatest(old.expires_at, new.expires_at);
  if new.last_touch_at < old.last_touch_at then
    new.utm_source := old.utm_source;
    new.utm_medium := old.utm_medium;
    new.utm_campaign := old.utm_campaign;
    new.utm_content := old.utm_content;
    new.utm_term := old.utm_term;
    new.landing_url := old.landing_url;
    new.referrer_url := old.referrer_url;
    new.client_user_agent := old.client_user_agent;
    new.ad_user_data_consent := old.ad_user_data_consent;
    new.last_touch_at := old.last_touch_at;
  end if;
  return new;
end;
$$;

revoke all on function private.preserve_ad_attribution_touches()
  from public, anon, authenticated;
grant execute on function private.preserve_ad_attribution_touches()
  to service_role;

create trigger contact_ad_attributions_preserve_first_touch
  before update on public.contact_ad_attributions
  for each row execute function private.preserve_ad_attribution_touches();

create trigger contact_ad_attributions_set_updated_at
  before update on public.contact_ad_attributions
  for each row execute procedure public.set_updated_at();
create trigger ad_conversion_connections_set_updated_at
  before update on public.ad_conversion_connections
  for each row execute procedure public.set_updated_at();
create trigger ad_conversion_rules_set_updated_at
  before update on public.ad_conversion_rules
  for each row execute procedure public.set_updated_at();
create trigger ad_conversion_events_set_updated_at
  before update on public.ad_conversion_events
  for each row execute procedure public.set_updated_at();

alter table public.contact_ad_attributions enable row level security;
alter table public.ad_conversion_connections enable row level security;
alter table public.ad_conversion_rules enable row level security;
alter table public.ad_conversion_events enable row level security;
alter table public.ad_conversion_deliveries enable row level security;

revoke all on public.contact_ad_attributions from anon, authenticated;
revoke all on public.ad_conversion_connections from anon, authenticated;
revoke all on public.ad_conversion_rules from anon, authenticated;
revoke all on public.ad_conversion_events from anon, authenticated;
revoke all on public.ad_conversion_deliveries from anon, authenticated;
grant all on public.contact_ad_attributions to service_role;
grant all on public.ad_conversion_connections to service_role;
grant all on public.ad_conversion_rules to service_role;
grant all on public.ad_conversion_events to service_role;
grant all on public.ad_conversion_deliveries to service_role;

create or replace function private.enqueue_ad_conversion_on_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_rule public.ad_conversion_rules%rowtype;
  conversion_event_id uuid;
  selected_value bigint;
begin
  if tg_op = 'UPDATE' and old.stage_id is not distinct from new.stage_id then
    return new;
  end if;

  select * into selected_rule
  from public.ad_conversion_rules rule
  where rule.workspace_id = new.workspace_id
    and rule.stage_id = new.stage_id
    and rule.is_active
  limit 1;

  if not found then return new; end if;

  selected_value := case selected_rule.value_mode
    when 'lead' then new.value_cents
    when 'fixed' then selected_rule.fixed_value_cents
    else null
  end;

  insert into public.ad_conversion_events (
    workspace_id, rule_id, lead_id, contact_id, stage_id,
    event_name, value_cents, currency
  ) values (
    new.workspace_id, selected_rule.id, new.id, new.contact_id, new.stage_id,
    selected_rule.name, selected_value,
    case when selected_rule.value_mode = 'lead' then new.currency else selected_rule.currency end
  )
  on conflict (rule_id, lead_id) do nothing
  returning id into conversion_event_id;

  if conversion_event_id is not null then
    insert into public.scheduled_jobs (
      workspace_id, kind, payload, run_at, dedupe_key
    ) values (
      new.workspace_id,
      'ad_conversion',
      jsonb_build_object('conversionEventId', conversion_event_id),
      timezone('utc', now()),
      'ad-conversion:' || selected_rule.id::text || ':' || new.id::text
    ) on conflict (workspace_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.enqueue_ad_conversion_on_stage() from public, anon, authenticated;
grant execute on function private.enqueue_ad_conversion_on_stage() to service_role;

create trigger crm_leads_enqueue_ad_conversion
after insert or update on public.crm_leads
for each row execute function private.enqueue_ad_conversion_on_stage();

comment on table public.contact_ad_attributions is
  'Atribuição publicitária first-touch por contato. IP bruto não é persistido.';
comment on table public.ad_conversion_events is
  'Outbox OCI/CAPI idempotente por regra e lead; nenhum payload com PII é armazenado.';
comment on function private.enqueue_ad_conversion_on_stage() is
  'Enfileira uma conversão quando um lead entra em uma etapa mapeada.';
