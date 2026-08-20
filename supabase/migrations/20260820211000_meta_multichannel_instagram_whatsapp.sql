-- Wal Chat - núcleo multicanal oficial da Meta.
--
-- A migration é aditiva: preserva todos os vínculos do Instagram e acrescenta
-- WhatsApp Cloud API por workspace, credenciais cifradas, templates, Inbox,
-- idempotência de saída e ingestão transacional de webhooks.

create table public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  waba_id text not null check (waba_id ~ '^[0-9]{5,40}$'),
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{5,40}$'),
  business_id text,
  display_phone_number text,
  verified_name text,
  quality_rating text,
  messaging_limit_tier text,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'expired', 'disconnected')),
  scopes text[] not null default '{}',
  subscribed_fields text[] not null default '{}',
  token_expires_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  permissions_validated_at timestamptz,
  webhook_subscribed_at timestamptz,
  last_sync_at timestamptz,
  connection_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, phone_number_id),
  unique (workspace_id, waba_id, phone_number_id)
);

create index whatsapp_accounts_waba_idx
  on public.whatsapp_accounts (waba_id)
  where status = 'connected';
create index whatsapp_accounts_phone_idx
  on public.whatsapp_accounts (phone_number_id)
  where status = 'connected';

alter table public.integration_credentials
  add column if not exists whatsapp_account_id uuid
  references public.whatsapp_accounts(id) on delete cascade;

alter table public.integration_credentials
  drop constraint if exists integration_credentials_single_meta_account;
alter table public.integration_credentials
  add constraint integration_credentials_single_meta_account
  check (instagram_account_id is null or whatsapp_account_id is null);

create index integration_credentials_whatsapp_account_idx
  on public.integration_credentials (whatsapp_account_id)
  where whatsapp_account_id is not null;

alter table public.contacts
  add column if not exists platform text not null default 'instagram',
  add column if not exists whatsapp_account_id uuid
    references public.whatsapp_accounts(id) on delete set null,
  add column if not exists whatsapp_user_id text;

alter table public.contacts alter column instagram_user_id drop not null;
alter table public.contacts drop constraint if exists contacts_platform_check;
alter table public.contacts add constraint contacts_platform_check check (
  (platform = 'instagram' and instagram_user_id is not null and whatsapp_account_id is null and whatsapp_user_id is null)
  or
  (platform = 'whatsapp' and instagram_account_id is null and whatsapp_account_id is not null and whatsapp_user_id is not null)
);

create unique index contacts_whatsapp_identity_unique
  on public.contacts (workspace_id, whatsapp_account_id, whatsapp_user_id)
  where platform = 'whatsapp';
create index contacts_workspace_platform_idx
  on public.contacts (workspace_id, platform, last_interaction_at desc);

alter table public.conversations
  add column if not exists platform text not null default 'instagram',
  add column if not exists whatsapp_account_id uuid
    references public.whatsapp_accounts(id) on delete cascade;

alter table public.conversations drop constraint if exists conversations_platform_check;
alter table public.conversations add constraint conversations_platform_check check (
  (platform = 'instagram' and whatsapp_account_id is null)
  or
  (platform = 'whatsapp' and instagram_account_id is null and whatsapp_account_id is not null)
);

alter table public.conversations
  add constraint conversations_workspace_contact_platform_unique
  unique (workspace_id, contact_id, platform);
create index conversations_workspace_platform_last_idx
  on public.conversations (workspace_id, platform, last_message_at desc);

alter table public.interactions_log
  add column if not exists platform text not null default 'instagram',
  add column if not exists whatsapp_account_id uuid
    references public.whatsapp_accounts(id) on delete set null;

alter table public.interactions_log
  drop constraint if exists interactions_log_platform_check;
alter table public.interactions_log add constraint interactions_log_platform_check check (
  platform in ('instagram', 'whatsapp') and
  not (instagram_account_id is not null and whatsapp_account_id is not null)
);

alter table public.messages
  add column if not exists platform text not null default 'instagram',
  add column if not exists provider_message_id text,
  add column if not exists message_type text not null default 'text';

alter table public.messages drop constraint if exists messages_platform_check;
alter table public.messages add constraint messages_platform_check
  check (platform in ('instagram', 'whatsapp'));
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check
  check (message_type in ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive', 'template', 'reaction', 'unknown'));
create index messages_provider_message_idx
  on public.messages (provider_message_id)
  where provider_message_id is not null;

alter table public.webhook_events
  add column if not exists provider text not null default 'instagram',
  add column if not exists external_account_id text,
  add column if not exists whatsapp_business_account_id text,
  add column if not exists whatsapp_phone_number_id text;

alter table public.webhook_events drop constraint if exists webhook_events_provider_check;
alter table public.webhook_events add constraint webhook_events_provider_check
  check (provider in ('instagram', 'whatsapp'));
create index webhook_events_provider_status_received_idx
  on public.webhook_events (provider, status, received_at desc);

alter table public.outbound_deliveries
  add column if not exists platform text not null default 'instagram',
  add column if not exists whatsapp_account_id uuid
    references public.whatsapp_accounts(id) on delete cascade,
  add column if not exists message_type text not null default 'text',
  add column if not exists template_name text,
  add column if not exists template_language text;

alter table public.outbound_deliveries alter column instagram_account_id drop not null;
alter table public.outbound_deliveries
  drop constraint if exists outbound_deliveries_platform_account_check;
alter table public.outbound_deliveries
  add constraint outbound_deliveries_platform_account_check check (
    (platform = 'instagram' and instagram_account_id is not null and whatsapp_account_id is null)
    or
    (platform = 'whatsapp' and instagram_account_id is null and whatsapp_account_id is not null)
  );
alter table public.outbound_deliveries
  drop constraint if exists outbound_deliveries_message_type_check;
alter table public.outbound_deliveries
  add constraint outbound_deliveries_message_type_check check (
    (message_type = 'text' and template_name is null)
    or
    (message_type = 'template' and template_name is not null and template_language is not null)
  );

create table public.whatsapp_message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  whatsapp_account_id uuid not null references public.whatsapp_accounts(id) on delete cascade,
  meta_template_id text,
  name text not null,
  language text not null,
  category text,
  status text not null,
  parameter_format text,
  components jsonb not null default '[]'::jsonb,
  rejected_reason text,
  last_synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (whatsapp_account_id, name, language)
);

create index whatsapp_templates_workspace_status_idx
  on public.whatsapp_message_templates (workspace_id, status, name);

alter table public.whatsapp_accounts enable row level security;
alter table public.whatsapp_message_templates enable row level security;

create policy whatsapp_accounts_select on public.whatsapp_accounts
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy whatsapp_templates_select on public.whatsapp_message_templates
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.whatsapp_accounts from authenticated;
revoke insert, update, delete on public.whatsapp_message_templates from authenticated;
grant select on public.whatsapp_accounts to authenticated;
grant select on public.whatsapp_message_templates to authenticated;
grant all on public.whatsapp_accounts to service_role;
grant all on public.whatsapp_message_templates to service_role;

create trigger set_whatsapp_accounts_updated_at
  before update on public.whatsapp_accounts
  for each row execute procedure public.set_updated_at();
create trigger set_whatsapp_templates_updated_at
  before update on public.whatsapp_message_templates
  for each row execute procedure public.set_updated_at();

-- Uma mensagem inbound do WhatsApp atualiza CRM, janela de atendimento, Inbox
-- e mensagem de forma atômica. Redeliveries reparam dados sem duplicar unread.
create or replace function public.ingest_whatsapp_inbound(
  target_workspace_id uuid,
  target_account_id uuid,
  sender_id text,
  sender_name text,
  sender_phone text,
  event_id text,
  event_text text,
  event_type text,
  event_media_url text,
  event_raw jsonb,
  received_at timestamptz
)
returns table (
  contact_id uuid,
  interaction_id uuid,
  conversation_id uuid,
  interaction_inserted boolean,
  contact_ai_enabled boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  resolved_contact_id uuid;
  resolved_interaction_id uuid;
  resolved_conversation_id uuid;
  was_inserted boolean := false;
  ai_is_enabled boolean;
  contact_category text;
  resolved_type text;
begin
  if sender_id is null or sender_id = '' or event_id is null or event_id = '' then
    raise exception 'invalid_whatsapp_inbound_identity';
  end if;
  if not exists (
    select 1 from public.whatsapp_accounts account
    where account.id = target_account_id
      and account.workspace_id = target_workspace_id
      and account.status = 'connected'
  ) then
    raise exception 'invalid_whatsapp_account';
  end if;

  resolved_type := case
    when event_type in ('text','image','audio','video','document','sticker','location','contacts','interactive','reaction')
      then event_type
    else 'unknown'
  end;

  insert into public.contacts (
    workspace_id, platform, whatsapp_account_id, whatsapp_user_id,
    instagram_user_id, full_name, phone
  ) values (
    target_workspace_id, 'whatsapp', target_account_id, sender_id,
    null, nullif(sender_name, ''), nullif(sender_phone, '')
  )
  on conflict (workspace_id, whatsapp_account_id, whatsapp_user_id)
  where platform = 'whatsapp'
  do update set
    full_name = coalesce(excluded.full_name, public.contacts.full_name),
    phone = coalesce(excluded.phone, public.contacts.phone),
    whatsapp_account_id = excluded.whatsapp_account_id
  returning id, ai_enabled, inbox_category
  into resolved_contact_id, ai_is_enabled, contact_category;

  update public.contacts
  set last_interaction_at = greatest(
        coalesce(last_interaction_at, '-infinity'::timestamptz), received_at
      ),
      last_inbound_at = greatest(
        coalesce(last_inbound_at, '-infinity'::timestamptz), received_at
      )
  where id = resolved_contact_id and workspace_id = target_workspace_id;

  select log.id into resolved_interaction_id
  from public.interactions_log log
  where log.workspace_id = target_workspace_id and log.meta_event_id = event_id;

  if resolved_interaction_id is null then
    insert into public.interactions_log (
      workspace_id, platform, whatsapp_account_id, contact_id, meta_event_id,
      channel, direction, message_text, media_url, status, meta_created_at,
      raw_payload
    ) values (
      target_workspace_id, 'whatsapp', target_account_id, resolved_contact_id,
      event_id, 'dm', 'inbound', event_text, event_media_url, 'delivered',
      received_at, coalesce(event_raw, '{}'::jsonb)
    )
    on conflict (workspace_id, meta_event_id) where meta_event_id is not null
    do nothing
    returning id into resolved_interaction_id;

    if resolved_interaction_id is not null then
      was_inserted := true;
    else
      select log.id into resolved_interaction_id
      from public.interactions_log log
      where log.workspace_id = target_workspace_id and log.meta_event_id = event_id;
    end if;
  end if;

  insert into public.conversations (
    workspace_id, platform, whatsapp_account_id, contact_id, category,
    unread_count, last_message_preview, last_message_at
  ) values (
    target_workspace_id, 'whatsapp', target_account_id, resolved_contact_id,
    contact_category, case when was_inserted then 1 else 0 end,
    left(coalesce(nullif(event_text, ''), '[' || resolved_type || ']'), 180),
    received_at
  )
  on conflict (workspace_id, contact_id, platform) do update
  set unread_count = public.conversations.unread_count +
        case when was_inserted then 1 else 0 end,
      whatsapp_account_id = excluded.whatsapp_account_id,
      last_message_preview = case
        when public.conversations.last_message_at is null
          or excluded.last_message_at >= public.conversations.last_message_at
        then excluded.last_message_preview
        else public.conversations.last_message_preview
      end,
      last_message_at = greatest(
        coalesce(public.conversations.last_message_at, '-infinity'::timestamptz),
        excluded.last_message_at
      )
  returning id into resolved_conversation_id;

  update public.interactions_log
  set conversation_id = resolved_conversation_id,
      contact_id = resolved_contact_id
  where id = resolved_interaction_id;

  insert into public.messages (
    workspace_id, platform, conversation_id, contact_id, interaction_id,
    provider_message_id, direction, body, media_url, message_type, status
  ) values (
    target_workspace_id, 'whatsapp', resolved_conversation_id,
    resolved_contact_id, resolved_interaction_id, event_id, 'inbound',
    event_text, event_media_url, resolved_type, 'delivered'
  )
  on conflict (interaction_id) do update
  set conversation_id = excluded.conversation_id,
      contact_id = excluded.contact_id,
      body = excluded.body,
      media_url = coalesce(excluded.media_url, public.messages.media_url),
      message_type = excluded.message_type,
      provider_message_id = excluded.provider_message_id;

  return query select resolved_contact_id, resolved_interaction_id,
    resolved_conversation_id, was_inserted, ai_is_enabled;
end;
$$;

revoke all on function public.ingest_whatsapp_inbound(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_inbound(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, timestamptz
) to service_role;

comment on table public.whatsapp_accounts is
  'WABAs e telefones da WhatsApp Cloud API conectados por workspace.';
comment on table public.whatsapp_message_templates is
  'Cache de templates oficiais do WhatsApp, sincronizado pela API da Meta.';
comment on function public.ingest_whatsapp_inbound(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, timestamptz
) is 'Ingestão transacional e idempotente de mensagens inbound do WhatsApp.';
