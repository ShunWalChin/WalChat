-- Wal Chat — hardening do core backend.
-- Defesa em profundidade: RLS mínimo, ingestão inbound transacional, claims
-- concorrentes com SKIP LOCKED e deduplicação persistente de jobs/automações.

alter table public.outbound_deliveries
  drop constraint if exists outbound_deliveries_status_check;
alter table public.outbound_deliveries
  add constraint outbound_deliveries_status_check
  check (status in ('claimed', 'sent', 'blocked', 'failed', 'unknown'));

alter table public.comment_private_replies
  drop constraint if exists comment_private_replies_status_check;
alter table public.comment_private_replies
  add constraint comment_private_replies_status_check
  check (status in ('pending', 'sent', 'failed', 'unknown'));

alter table public.sequence_enrollments
  add column if not exists trigger_id uuid references public.triggers(id) on delete set null,
  add column if not exists source_interaction_id uuid references public.interactions_log(id) on delete set null;

create unique index if not exists sequence_enrollments_trigger_interaction_unique
  on public.sequence_enrollments (trigger_id, source_interaction_id);

alter table public.scheduled_jobs
  add column if not exists dedupe_key text;

alter table public.scheduled_jobs
  add constraint scheduled_jobs_dedupe_key_length
  check (dedupe_key is null or char_length(dedupe_key) between 16 and 180);

create unique index if not exists scheduled_jobs_workspace_dedupe_unique
  on public.scheduled_jobs (workspace_id, dedupe_key);

create index if not exists scheduled_jobs_due_idx
  on public.scheduled_jobs (run_at, id)
  where status = 'pending';
create index if not exists scheduled_jobs_stale_processing_idx
  on public.scheduled_jobs (locked_at)
  where status = 'processing';
create index if not exists outbound_deliveries_stale_claim_idx
  on public.outbound_deliveries (claimed_at)
  where status = 'claimed';

-- Claim de lote em uma única transação. SKIP LOCKED permite múltiplos schedulers
-- sem executar o mesmo job e sem depender de select/update separados.
create or replace function public.claim_due_scheduled_jobs(batch_size integer default 50)
returns setof public.scheduled_jobs
language sql
volatile
security definer
set search_path = ''
as $$
  with due as (
    select job.id
    from public.scheduled_jobs job
    where job.status = 'pending'
      and job.run_at <= timezone('utc', now())
    order by job.run_at, job.id
    for update skip locked
    limit greatest(1, least(batch_size, 100))
  )
  update public.scheduled_jobs job
  set status = 'processing',
      locked_at = timezone('utc', now()),
      attempts = job.attempts + 1
  from due
  where job.id = due.id
  returning job.*;
$$;

revoke all on function public.claim_due_scheduled_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_scheduled_jobs(integer)
  to service_role;

-- Contact, interaction, conversation and message become one atomic unit. A
-- duplicate event repairs partial historical data but never increments unread
-- twice. Reactions remain telemetry and do not create inbox messages.
create or replace function public.ingest_instagram_inbound(
  target_workspace_id uuid,
  target_account_id uuid,
  sender_id text,
  sender_username text,
  event_id text,
  event_channel public.interaction_channel,
  event_text text,
  event_raw jsonb,
  received_at timestamptz,
  opens_window boolean
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
begin
  if sender_id is null or sender_id = '' or event_id is null or event_id = '' then
    raise exception 'invalid_instagram_inbound_identity';
  end if;

  insert into public.contacts (
    workspace_id, instagram_account_id, instagram_user_id, username
  ) values (
    target_workspace_id, target_account_id, sender_id, nullif(sender_username, '')
  )
  on conflict (workspace_id, instagram_user_id) do update
  set instagram_account_id = excluded.instagram_account_id,
      username = coalesce(excluded.username, public.contacts.username)
  returning id, ai_enabled, inbox_category
  into resolved_contact_id, ai_is_enabled, contact_category;

  update public.contacts
  set last_interaction_at = greatest(
        coalesce(last_interaction_at, '-infinity'::timestamptz), received_at
      ),
      last_inbound_at = case
        when opens_window then greatest(
          coalesce(last_inbound_at, '-infinity'::timestamptz), received_at
        )
        else last_inbound_at
      end
  where id = resolved_contact_id and workspace_id = target_workspace_id;

  select log.id into resolved_interaction_id
  from public.interactions_log log
  where log.workspace_id = target_workspace_id and log.meta_event_id = event_id;

  if resolved_interaction_id is null then
    insert into public.interactions_log (
      workspace_id, instagram_account_id, contact_id, meta_event_id, channel,
      direction, message_text, status, meta_created_at, raw_payload
    ) values (
      target_workspace_id, target_account_id, resolved_contact_id, event_id,
      event_channel, 'inbound', event_text, 'delivered', received_at,
      coalesce(event_raw, '{}'::jsonb)
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

  if event_channel <> 'reaction' then
    insert into public.conversations (
      workspace_id, instagram_account_id, contact_id, category, unread_count,
      last_message_preview, last_message_at
    ) values (
      target_workspace_id, target_account_id, resolved_contact_id,
      contact_category, case when was_inserted then 1 else 0 end,
      left(coalesce(event_text, ''), 180), received_at
    )
    on conflict (workspace_id, contact_id, instagram_account_id) do update
    set unread_count = public.conversations.unread_count +
          case when was_inserted then 1 else 0 end,
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
      workspace_id, conversation_id, contact_id, interaction_id, direction,
      body, status
    ) values (
      target_workspace_id, resolved_conversation_id, resolved_contact_id,
      resolved_interaction_id, 'inbound', event_text, 'delivered'
    )
    on conflict (interaction_id) do update
    set conversation_id = excluded.conversation_id,
        contact_id = excluded.contact_id;
  end if;

  return query select resolved_contact_id, resolved_interaction_id,
    resolved_conversation_id, was_inserted, ai_is_enabled;
end;
$$;

revoke all on function public.ingest_instagram_inbound(
  uuid, uuid, text, text, text, public.interaction_channel, text, jsonb,
  timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.ingest_instagram_inbound(
  uuid, uuid, text, text, text, public.interaction_channel, text, jsonb,
  timestamptz, boolean
) to service_role;

-- Cadastro resiliente a metadados longos, slug vazio e colisões triviais.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  base_slug text;
  workspace_name text;
begin
  base_slug := lower(regexp_replace(
    split_part(coalesce(new.email, 'wal'), '@', 1),
    '[^a-z0-9]+', '-', 'g'
  ));
  base_slug := trim(both '-' from base_slug);
  if char_length(base_slug) < 2 then base_slug := 'wal'; end if;
  workspace_name := left(
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Meu Wal Chat'),
    80
  );
  insert into public.workspaces (owner_id, name, slug)
  values (
    new.id,
    workspace_name,
    left(base_slug, 49) || '-' || replace(left(new.id::text, 13), '-', '')
  ) returning id into new_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');
  return new;
end;
$$;

-- Membership is managed only through future privileged APIs. This closes role
-- escalation (admin -> owner) through direct PostgREST writes.
drop policy if exists members_manage on public.workspace_members;
revoke insert, update, delete on public.workspace_members from authenticated;

drop policy if exists workspace_update on public.workspaces;
create policy workspace_update_owner on public.workspaces
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Operational tables are backend-owned. Authenticated users may read through
-- RLS where granted, but all writes go through role-checked server endpoints.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'contacts','conversations','interactions_log','messages','trigger_cooldowns',
    'comment_private_replies','sequence_enrollments','scheduled_jobs',
    'webhook_events','campaign_recipients','insights_daily','automation_runs',
    'outbound_deliveries','workspace_runtime_settings'
  ] loop
    execute format('drop policy if exists tenant_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_update on public.%I', table_name);
    execute format('drop policy if exists tenant_delete on public.%I', table_name);
    execute format('revoke insert, update, delete on public.%I from authenticated', table_name);
  end loop;
end $$;

-- Configuração editorial/automação só pode ser alterada por owner/admin.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tags','posts_cache','sequences','sequence_steps','campaigns',
    'content_items','blocklist_entries'
  ] loop
    execute format('drop policy if exists tenant_insert on public.%I', table_name);
    execute format('drop policy if exists tenant_update on public.%I', table_name);
    execute format('drop policy if exists tenant_delete on public.%I', table_name);
    execute format(
      'create policy tenant_manage_privileged on public.%I for all to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'']::public.workspace_role[])) with check (public.has_workspace_role(workspace_id, array[''owner'',''admin'']::public.workspace_role[]))',
      table_name
    );
  end loop;
end $$;

drop policy if exists tenant_insert on public.contact_tags;
drop policy if exists tenant_update on public.contact_tags;
drop policy if exists tenant_delete on public.contact_tags;
create policy contact_tags_insert on public.contact_tags
  for insert to authenticated
  with check (
    public.has_workspace_role(
      workspace_id,
      array['owner','admin','agent']::public.workspace_role[]
    ) and (added_by is null or added_by = auth.uid())
  );
create policy contact_tags_delete on public.contact_tags
  for delete to authenticated
  using (public.has_workspace_role(
    workspace_id,
    array['owner','admin','agent']::public.workspace_role[]
  ));

drop policy if exists conversation_notes_insert on public.conversation_notes;
drop policy if exists conversation_notes_update on public.conversation_notes;
drop policy if exists conversation_notes_delete on public.conversation_notes;
create policy conversation_notes_insert on public.conversation_notes
  for insert to authenticated
  with check (
    author_user_id = auth.uid() and
    public.has_workspace_role(
      workspace_id,
      array['owner','admin','agent']::public.workspace_role[]
    )
  );
create policy conversation_notes_update on public.conversation_notes
  for update to authenticated
  using (
    author_user_id = auth.uid() and public.is_workspace_member(workspace_id)
  )
  with check (
    author_user_id = auth.uid() and public.is_workspace_member(workspace_id)
  );
create policy conversation_notes_delete on public.conversation_notes
  for delete to authenticated
  using (
    author_user_id = auth.uid() or
    public.has_workspace_role(
      workspace_id,
      array['owner','admin']::public.workspace_role[]
    )
  );

-- Future tables are read-only by default for authenticated until an explicit
-- policy and grant authorize mutation.
alter default privileges in schema public
  revoke insert, update, delete on tables from authenticated;
alter default privileges in schema public
  grant select on tables to authenticated;

-- Registro público por código opaco, sem persistir o Instagram user id em
-- claro. A função remove contatos, conta conectada e credenciais numa transação.
create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  external_user_hash text not null check (external_user_hash ~ '^[a-f0-9]{64}$'),
  confirmation_code text not null unique
    check (char_length(confirmation_code) between 24 and 128),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  affected_contacts integer not null default 0 check (affected_contacts >= 0),
  affected_accounts integer not null default 0 check (affected_accounts >= 0),
  requested_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  last_error_code text
);

alter table public.data_deletion_requests enable row level security;
revoke all on public.data_deletion_requests from public, anon, authenticated;
grant all on public.data_deletion_requests to service_role;

create or replace function public.process_meta_data_deletion(
  external_user_id text,
  target_confirmation_code text
)
returns public.data_deletion_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_row public.data_deletion_requests;
  affected_account_ids uuid[];
  affected_contact_ids uuid[];
  affected_enrollment_ids uuid[];
  affected_workspace_ids uuid[];
  deleted_contacts integer := 0;
  deleted_accounts integer := 0;
begin
  if external_user_id is null or char_length(external_user_id) not between 1 and 200 then
    raise exception 'invalid_external_user_id';
  end if;
  if target_confirmation_code is null
    or char_length(target_confirmation_code) not between 24 and 128 then
    raise exception 'invalid_confirmation_code';
  end if;

  insert into public.data_deletion_requests (
    external_user_hash, confirmation_code, status
  ) values (
    encode(extensions.digest(external_user_id, 'sha256'), 'hex'),
    target_confirmation_code,
    'processing'
  ) returning * into request_row;

  select array_agg(account.id)
  into affected_account_ids
  from public.instagram_accounts account
  where account.instagram_user_id = external_user_id;

  select array_agg(contact.id)
  into affected_contact_ids
  from public.contacts contact
  where contact.instagram_user_id = external_user_id
     or (
       affected_account_ids is not null
       and contact.instagram_account_id = any(affected_account_ids)
     );

  select array_agg(distinct source.workspace_id)
  into affected_workspace_ids
  from (
    select account.workspace_id
    from public.instagram_accounts account
    where account.instagram_user_id = external_user_id
    union
    select contact.workspace_id
    from public.contacts contact
    where contact.instagram_user_id = external_user_id
       or (
         affected_account_ids is not null
         and contact.instagram_account_id = any(affected_account_ids)
       )
  ) source;

  if affected_workspace_ids is not null then
    update public.workspace_runtime_settings
    set external_sends_enabled = false,
        comment_to_dm_enabled = false,
        autonomous_ai_enabled = false,
        activated_at = null,
        activated_by = null
    where workspace_id = any(affected_workspace_ids);
  end if;

  if affected_contact_ids is not null then
    select array_agg(enrollment.id)
    into affected_enrollment_ids
    from public.sequence_enrollments enrollment
    where enrollment.contact_id = any(affected_contact_ids);

    -- Remove referências que usam ON DELETE SET NULL ou JSON. Sem essa etapa,
    -- conteúdo pessoal poderia sobreviver sem o vínculo relacional do contato.
    delete from public.comment_private_replies reply
    where reply.contact_id = any(affected_contact_ids)
       or reply.interaction_id in (
         select interaction.id
         from public.interactions_log interaction
         where interaction.contact_id = any(affected_contact_ids)
       );

    delete from public.automation_runs run
    where run.contact_id = any(affected_contact_ids)
       or run.interaction_id in (
         select interaction.id
         from public.interactions_log interaction
         where interaction.contact_id = any(affected_contact_ids)
       )
       or position(external_user_id in run.metadata::text) > 0;

    delete from public.scheduled_jobs job
    where job.workspace_id = any(affected_workspace_ids)
      and (
        job.payload ->> 'contactId' in (
          select contact_id::text from unnest(affected_contact_ids) contact_id
        )
        or (
          affected_enrollment_ids is not null
          and job.payload ->> 'enrollmentId' in (
            select enrollment_id::text
            from unnest(affected_enrollment_ids) enrollment_id
          )
        )
        or position(external_user_id in job.payload::text) > 0
      );

    delete from public.interactions_log interaction
    where interaction.contact_id = any(affected_contact_ids)
       or (
         interaction.workspace_id = any(affected_workspace_ids)
         and position(external_user_id in interaction.raw_payload::text) > 0
       );

    delete from public.contacts contact
    where contact.id = any(affected_contact_ids);
    get diagnostics deleted_contacts = row_count;
  end if;

  if affected_workspace_ids is not null then
    delete from public.webhook_events event
    where event.workspace_id = any(affected_workspace_ids)
      and (
        event.instagram_user_id = external_user_id
        or position(external_user_id in event.payload::text) > 0
      );
  end if;

  if affected_account_ids is not null then
    delete from public.integration_audit_logs audit
    where audit.resource_id in (
      select account_id::text from unnest(affected_account_ids) account_id
    );

    delete from public.instagram_accounts account
    where account.id = any(affected_account_ids);
    get diagnostics deleted_accounts = row_count;
  end if;

  update public.data_deletion_requests
  set status = 'completed',
      affected_contacts = deleted_contacts,
      affected_accounts = deleted_accounts,
      completed_at = timezone('utc', now()),
      last_error_code = null
  where id = request_row.id
  returning * into request_row;
  return request_row;
end;
$$;

revoke all on function public.process_meta_data_deletion(text, text)
  from public, anon, authenticated;
grant execute on function public.process_meta_data_deletion(text, text)
  to service_role;

comment on function public.ingest_instagram_inbound(
  uuid, uuid, text, text, text, public.interaction_channel, text, jsonb,
  timestamptz, boolean
) is 'Ingestão transacional e reparável de evento inbound do Instagram.';
comment on function public.claim_due_scheduled_jobs(integer) is
  'Claim concorrente de jobs usando FOR UPDATE SKIP LOCKED.';
comment on table public.data_deletion_requests is
  'Comprovante sem PII da exclusão de dados solicitada pela Meta.';
