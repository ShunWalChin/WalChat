-- Wal Chat - CRM operacional de contatos e tags.
-- A migration preserva identidades vindas da Meta e mantém campos editáveis
-- separados dos dados que podem ser atualizados pelos webhooks.

alter table public.contacts
  add column if not exists display_name text,
  add column if not exists company text,
  add column if not exists job_title text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country_code text,
  add column if not exists language text,
  add column if not exists timezone text,
  add column if not exists lifecycle_stage text not null default 'lead',
  add column if not exists lead_score smallint not null default 0,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists marketing_consent text not null default 'unknown',
  add column if not exists consent_updated_at timestamptz,
  add column if not exists consent_source text,
  add column if not exists archived_at timestamptz,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists import_source text;

alter table public.contacts drop constraint if exists contacts_display_name_check;
alter table public.contacts add constraint contacts_display_name_check
  check (display_name is null or char_length(display_name) between 1 and 120);
alter table public.contacts drop constraint if exists contacts_company_check;
alter table public.contacts add constraint contacts_company_check
  check (company is null or char_length(company) <= 120);
alter table public.contacts drop constraint if exists contacts_job_title_check;
alter table public.contacts add constraint contacts_job_title_check
  check (job_title is null or char_length(job_title) <= 120);
alter table public.contacts drop constraint if exists contacts_city_check;
alter table public.contacts add constraint contacts_city_check
  check (city is null or char_length(city) <= 100);
alter table public.contacts drop constraint if exists contacts_state_check;
alter table public.contacts add constraint contacts_state_check
  check (state is null or char_length(state) <= 100);
alter table public.contacts drop constraint if exists contacts_country_code_check;
alter table public.contacts add constraint contacts_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');
alter table public.contacts drop constraint if exists contacts_language_check;
alter table public.contacts add constraint contacts_language_check
  check (language is null or char_length(language) <= 12);
alter table public.contacts drop constraint if exists contacts_timezone_check;
alter table public.contacts add constraint contacts_timezone_check
  check (timezone is null or char_length(timezone) <= 80);
alter table public.contacts drop constraint if exists contacts_lifecycle_stage_check;
alter table public.contacts add constraint contacts_lifecycle_stage_check
  check (lifecycle_stage in ('lead','engaged','customer','vip','inactive'));
alter table public.contacts drop constraint if exists contacts_lead_score_check;
alter table public.contacts add constraint contacts_lead_score_check
  check (lead_score between 0 and 100);
alter table public.contacts drop constraint if exists contacts_marketing_consent_check;
alter table public.contacts add constraint contacts_marketing_consent_check
  check (marketing_consent in ('unknown','granted','revoked'));
alter table public.contacts drop constraint if exists contacts_custom_fields_object_check;
alter table public.contacts add constraint contacts_custom_fields_object_check
  check (jsonb_typeof(custom_fields) = 'object');

-- Contatos manuais vivem no CRM, mas não podem ser usados como destino de
-- mensagens até que uma identidade Meta real seja associada por um webhook.
alter table public.contacts drop constraint if exists contacts_platform_check;
alter table public.contacts add constraint contacts_platform_check check (
  (
    platform = 'instagram' and instagram_user_id is not null and
    whatsapp_account_id is null and whatsapp_user_id is null
  ) or (
    platform = 'whatsapp' and instagram_account_id is null and
    whatsapp_account_id is not null and whatsapp_user_id is not null
  ) or (
    platform = 'manual' and instagram_account_id is null and
    instagram_user_id is null and whatsapp_account_id is null and
    whatsapp_user_id is null and (email is not null or phone is not null)
  )
);

create unique index if not exists contacts_manual_email_unique
  on public.contacts (workspace_id, lower(email))
  where platform = 'manual' and email is not null;
create unique index if not exists contacts_manual_phone_unique
  on public.contacts (workspace_id, phone)
  where platform = 'manual' and phone is not null;
create index if not exists contacts_workspace_active_recent_idx
  on public.contacts (workspace_id, archived_at, last_interaction_at desc);
create index if not exists contacts_workspace_stage_idx
  on public.contacts (workspace_id, lifecycle_stage, archived_at);
create index if not exists contacts_workspace_assigned_idx
  on public.contacts (workspace_id, assigned_to)
  where assigned_to is not null;

alter table public.tags
  add column if not exists description text,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.tags drop constraint if exists tags_description_check;
alter table public.tags add constraint tags_description_check
  check (description is null or char_length(description) <= 240);
create index if not exists tags_workspace_active_name_idx
  on public.tags (workspace_id, archived_at, lower(name));

alter table public.contact_tags
  add column if not exists source text not null default 'manual',
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.contact_tags drop constraint if exists contact_tags_source_check;
alter table public.contact_tags add constraint contact_tags_source_check
  check (source in ('manual','trigger','sequence','import','system'));
alter table public.contact_tags drop constraint if exists contact_tags_metadata_object_check;
alter table public.contact_tags add constraint contact_tags_metadata_object_check
  check (jsonb_typeof(metadata) = 'object');

create table public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  is_pinned boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index contact_notes_contact_recent_idx
  on public.contact_notes (contact_id, is_pinned desc, created_at desc);

create table public.contact_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index contact_audit_contact_recent_idx
  on public.contact_audit_log (contact_id, created_at desc);

create trigger set_contact_notes_updated_at
  before update on public.contact_notes
  for each row execute procedure public.set_updated_at();

alter table public.contact_notes enable row level security;
alter table public.contact_audit_log enable row level security;

create policy contact_notes_select on public.contact_notes
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy contact_notes_insert on public.contact_notes
  for insert to authenticated
  with check (
    author_user_id = auth.uid() and public.has_workspace_role(
      workspace_id,
      array['owner','admin','agent']::public.workspace_role[]
    )
  );
create policy contact_notes_update on public.contact_notes
  for update to authenticated
  using (
    author_user_id = auth.uid() and public.has_workspace_role(
      workspace_id,
      array['owner','admin','agent']::public.workspace_role[]
    )
  )
  with check (author_user_id = auth.uid());
create policy contact_notes_delete on public.contact_notes
  for delete to authenticated
  using (
    author_user_id = auth.uid() or public.has_workspace_role(
      workspace_id,
      array['owner','admin']::public.workspace_role[]
    )
  );
create policy contact_audit_select on public.contact_audit_log
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create or replace function public.list_workspace_contacts_crm(
  target_workspace_id uuid,
  search_term text default '',
  platform_filter text default null,
  eligibility_filter text default null,
  lifecycle_filter text default null,
  tag_filter uuid default null,
  archived_filter text default 'active',
  assignment_filter text default null,
  sort_field text default 'recent',
  page_size integer default 25,
  page_offset integer default 0
)
returns table (
  id uuid,
  platform text,
  username text,
  full_name text,
  display_name text,
  email text,
  phone text,
  instagram_user_id text,
  whatsapp_user_id text,
  avatar_url text,
  company text,
  job_title text,
  city text,
  state text,
  country_code text,
  language text,
  timezone text,
  lifecycle_stage text,
  lead_score smallint,
  assigned_to uuid,
  marketing_consent text,
  consent_updated_at timestamptz,
  consent_source text,
  ai_enabled boolean,
  opted_out_at timestamptz,
  last_interaction_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  first_seen_at timestamptz,
  archived_at timestamptz,
  custom_fields jsonb,
  eligibility text,
  seconds_left_24h integer,
  tags jsonb,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      contact.*,
      eligibility.eligibility::text as resolved_eligibility,
      eligibility.seconds_left_24h as resolved_seconds_left
    from public.contacts contact
    join public.contact_messaging_eligibility eligibility
      on eligibility.contact_id = contact.id
    where contact.workspace_id = target_workspace_id
      and (
        nullif(trim(search_term), '') is null or
        coalesce(contact.display_name, '') ilike '%' || trim(search_term) || '%' or
        coalesce(contact.full_name, '') ilike '%' || trim(search_term) || '%' or
        coalesce(contact.username, '') ilike '%' || trim(search_term) || '%' or
        coalesce(contact.email, '') ilike '%' || trim(search_term) || '%' or
        coalesce(contact.phone, '') ilike '%' || trim(search_term) || '%'
      )
      and (platform_filter is null or contact.platform = platform_filter)
      and (
        eligibility_filter is null or
        eligibility.eligibility::text = eligibility_filter
      )
      and (
        lifecycle_filter is null or
        contact.lifecycle_stage = lifecycle_filter
      )
      and (
        archived_filter = 'all' or
        (archived_filter = 'archived' and contact.archived_at is not null) or
        (archived_filter = 'active' and contact.archived_at is null)
      )
      and (
        assignment_filter is null or
        (assignment_filter = 'unassigned' and contact.assigned_to is null) or
        contact.assigned_to::text = assignment_filter
      )
      and (
        tag_filter is null or exists (
          select 1
          from public.contact_tags contact_tag
          where contact_tag.contact_id = contact.id
            and contact_tag.tag_id = tag_filter
        )
      )
  ),
  paged as (
    select filtered.*, count(*) over() as resolved_total_count
    from filtered
    order by
      case when sort_field = 'name' then lower(coalesce(display_name, full_name, username, phone, email, '')) end asc,
      case when sort_field = 'score' then lead_score end desc,
      case when sort_field = 'newest' then first_seen_at end desc,
      case when sort_field = 'oldest' then first_seen_at end asc,
      case when sort_field = 'recent' then last_interaction_at end desc nulls last,
      id asc
    limit least(greatest(page_size, 1), 100)
    offset greatest(page_offset, 0)
  )
  select
    paged.id,
    paged.platform,
    paged.username,
    paged.full_name,
    paged.display_name,
    paged.email,
    paged.phone,
    paged.instagram_user_id,
    paged.whatsapp_user_id,
    paged.avatar_url,
    paged.company,
    paged.job_title,
    paged.city,
    paged.state,
    paged.country_code,
    paged.language,
    paged.timezone,
    paged.lifecycle_stage,
    paged.lead_score,
    paged.assigned_to,
    paged.marketing_consent,
    paged.consent_updated_at,
    paged.consent_source,
    paged.ai_enabled,
    paged.opted_out_at,
    paged.last_interaction_at,
    paged.last_inbound_at,
    paged.last_outbound_at,
    paged.first_seen_at,
    paged.archived_at,
    paged.custom_fields,
    paged.resolved_eligibility,
    paged.resolved_seconds_left,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', tag.id,
          'name', tag.name,
          'color', tag.color,
          'isAutomatic', tag.is_automatic,
          'source', contact_tag.source
        ) order by tag.name
      )
      from public.contact_tags contact_tag
      join public.tags tag on tag.id = contact_tag.tag_id
      where contact_tag.contact_id = paged.id
        and tag.archived_at is null
    ), '[]'::jsonb) as tags,
    paged.resolved_total_count
  from paged;
$$;

revoke all on function public.list_workspace_contacts_crm(
  uuid, text, text, text, text, uuid, text, text, text, integer, integer
) from public;
grant execute on function public.list_workspace_contacts_crm(
  uuid, text, text, text, text, uuid, text, text, text, integer, integer
) to authenticated, service_role;

revoke insert, update, delete on public.contact_audit_log from authenticated;
grant select on public.contact_audit_log to authenticated;
grant select, insert, update, delete on public.contact_notes to authenticated;
grant all on public.contact_notes, public.contact_audit_log to service_role;

comment on column public.contacts.display_name is
  'Nome editável no CRM; não é sobrescrito pela sincronização do provedor.';
comment on column public.contacts.platform is
  'Instagram, WhatsApp ou manual. Manual não possui elegibilidade de mensageria.';
comment on table public.contact_notes is
  'Notas internas do CRM, visíveis somente aos membros do workspace.';
comment on table public.contact_audit_log is
  'Trilha imutável das ações manuais aplicadas a um contato.';
comment on function public.list_workspace_contacts_crm(
  uuid, text, text, text, text, uuid, text, text, text, integer, integer
) is 'Lista paginada, filtrável e tenant-safe usada pelo CRM de contatos.';
