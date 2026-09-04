-- Wal Chat — metadados de anexos privados do CRM.
-- O objeto binário vive no Supabase Storage; o banco guarda somente a chave e
-- registra a atividade de forma atômica.

create table if not exists public.crm_lead_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  storage_bucket text not null default 'crm-assets',
  storage_path text not null check (char_length(storage_path) between 10 and 700),
  file_name text not null check (char_length(file_name) between 1 and 180),
  mime_type text not null check (char_length(mime_type) between 3 and 120),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (storage_bucket, storage_path)
);

create index if not exists crm_lead_assets_timeline_idx
  on public.crm_lead_assets (workspace_id, lead_id, created_at desc)
  where deleted_at is null;

alter table public.crm_lead_assets enable row level security;
revoke all on public.crm_lead_assets from anon, authenticated;
grant select, insert, update, delete on public.crm_lead_assets to service_role;

create or replace function public.crm_register_asset_command(
  target_workspace_id uuid,
  actor_user_id uuid,
  target_lead_id uuid,
  target_storage_path text,
  target_file_name text,
  target_mime_type text,
  target_size_bytes bigint,
  request_user_agent text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lead_row public.crm_leads%rowtype;
  asset_row public.crm_lead_assets%rowtype;
  activity_row public.crm_lead_activities%rowtype;
begin
  select * into lead_row from public.crm_leads
  where workspace_id = target_workspace_id and id = target_lead_id
  for update;
  if not found then
    raise exception 'crm_lead_not_found' using errcode = 'P0002';
  end if;
  if target_storage_path not like target_workspace_id::text || '/%'
     or target_storage_path not like target_workspace_id::text || '/' || target_lead_id::text || '/%' then
    raise exception 'invalid_crm_asset_path' using errcode = '23514';
  end if;

  insert into public.crm_lead_assets (
    workspace_id, lead_id, storage_path, file_name, mime_type, size_bytes,
    uploaded_by_user_id
  ) values (
    target_workspace_id, target_lead_id, target_storage_path, target_file_name,
    target_mime_type, target_size_bytes, actor_user_id
  ) returning * into asset_row;

  insert into public.crm_lead_activities (
    workspace_id, lead_id, contact_id, activity_type, payload,
    performed_by_user_id
  ) values (
    target_workspace_id,
    target_lead_id,
    lead_row.contact_id,
    'document',
    jsonb_build_object(
      'title', target_file_name,
      'assetId', asset_row.id,
      'mimeType', target_mime_type,
      'sizeBytes', target_size_bytes
    ),
    actor_user_id
  ) returning * into activity_row;

  update public.crm_leads set last_activity_at = activity_row.performed_at
  where workspace_id = target_workspace_id and id = target_lead_id;

  insert into public.api_audit_log (
    workspace_id, actor_user_id, action, resource_type, resource_id, changes,
    user_agent
  ) values (
    target_workspace_id,
    actor_user_id,
    'crm_asset_uploaded',
    'crm_lead_asset',
    asset_row.id,
    jsonb_build_object(
      'leadId', target_lead_id,
      'fileName', target_file_name,
      'mimeType', target_mime_type,
      'sizeBytes', target_size_bytes
    ),
    nullif(left(request_user_agent, 500), '')
  );

  return jsonb_build_object(
    'assetId', asset_row.id,
    'activityId', activity_row.id,
    'createdAt', activity_row.performed_at
  );
end;
$$;

revoke all on function public.crm_register_asset_command(uuid, uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.crm_register_asset_command(uuid, uuid, uuid, text, text, text, bigint, text) to service_role;

comment on table public.crm_lead_assets is
  'Metadados de anexos privados; o conteúdo é servido somente por URL assinada curta.';
comment on function public.crm_register_asset_command(uuid, uuid, uuid, text, text, text, bigint, text) is
  'Registra anexo, atividade, toque do lead e auditoria na mesma transação.';
