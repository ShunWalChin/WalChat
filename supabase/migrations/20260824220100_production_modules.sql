-- Operações que transformam os últimos protótipos do painel em módulos
-- persistentes. Funções mutáveis ficam restritas à service role; o backend
-- autenticado continua sendo a única fronteira HTTP autorizada.

alter table public.content_items
  add column if not exists provider_media_id text,
  add column if not exists publish_error_code text,
  add column if not exists last_publish_attempt_at timestamptz;

alter table public.campaigns
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

alter table public.insights_daily
  add column if not exists views integer not null default 0 check (views >= 0);
alter table public.posts_cache
  add column if not exists views integer not null default 0 check (views >= 0),
  add column if not exists shares integer not null default 0 check (shares >= 0);

create table if not exists public.auto_like_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  mode text not null default 'positive'
    check (mode in ('all','positive','keyword')),
  keywords text[] not null default array['quero','link','preço','valor','aula'],
  requested_enabled boolean not null default false,
  capability_supported boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  check (cardinality(keywords) between 1 and 30)
);

alter table public.auto_like_settings enable row level security;
revoke all on public.auto_like_settings from public, anon;
grant select, insert, update on public.auto_like_settings to authenticated;
grant all on public.auto_like_settings to service_role;

create policy auto_like_settings_member_select
  on public.auto_like_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy auto_like_settings_manager_write
  on public.auto_like_settings for all to authenticated
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

create trigger set_auto_like_settings_updated_at
  before update on public.auto_like_settings
  for each row execute procedure public.set_updated_at();

create or replace function public.save_sequence_definition(
  target_workspace_id uuid,
  target_sequence_id uuid,
  target_name text,
  target_description text,
  target_is_active boolean,
  target_steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sequence_id uuid;
  step_count integer;
  sending_steps integer;
begin
  if jsonb_typeof(target_steps) <> 'array' then
    raise exception 'sequence_steps_must_be_array';
  end if;
  step_count := jsonb_array_length(target_steps);
  if step_count < 1 or step_count > 50 then
    raise exception 'sequence_steps_out_of_range';
  end if;
  select count(*) into sending_steps
  from jsonb_array_elements(target_steps) step
  where step->>'kind' in ('text','media');
  if sending_steps < 1 then
    raise exception 'sequence_requires_message_step';
  end if;

  if target_sequence_id is null then
    insert into public.sequences (workspace_id, name, description, is_active)
    values (target_workspace_id, target_name, target_description, target_is_active)
    returning id into sequence_id;
  else
    update public.sequences
    set name = target_name,
        description = target_description,
        is_active = target_is_active
    where id = target_sequence_id and workspace_id = target_workspace_id
    returning id into sequence_id;
    if sequence_id is null then raise exception 'sequence_not_found'; end if;
    delete from public.sequence_steps
    where workspace_id = target_workspace_id and sequence_id = target_sequence_id;
  end if;

  insert into public.sequence_steps (
    workspace_id, sequence_id, position, kind, content, media_url, delay_seconds
  )
  select
    target_workspace_id,
    sequence_id,
    ordinality::integer - 1,
    (step->>'kind')::public.sequence_step_kind,
    nullif(step->>'content', ''),
    nullif(step->>'mediaUrl', ''),
    greatest(0, least(604800, coalesce((step->>'delaySeconds')::integer, 0)))
  from jsonb_array_elements(target_steps) with ordinality as valueset(step, ordinality);

  return sequence_id;
end;
$$;

revoke all on function public.save_sequence_definition(uuid,uuid,text,text,boolean,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_sequence_definition(uuid,uuid,text,text,boolean,jsonb)
  to service_role;

comment on function public.save_sequence_definition(uuid,uuid,text,text,boolean,jsonb) is
  'Substitui uma definição de sequência e todos os passos na mesma transação.';

create or replace function public.enqueue_content_publish(
  target_workspace_id uuid,
  target_content_item_id uuid,
  target_run_at timestamptz,
  target_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_status text;
  account_id uuid;
  job_id uuid;
begin
  if target_run_at < timezone('utc', now()) - interval '1 minute' then
    raise exception 'content_publish_time_in_past';
  end if;
  if char_length(target_dedupe_key) not between 16 and 180 then
    raise exception 'content_publish_invalid_dedupe_key';
  end if;

  select item.status, item.instagram_account_id
    into content_status, account_id
  from public.content_items item
  where item.id = target_content_item_id
    and item.workspace_id = target_workspace_id
  for update;

  if not found then raise exception 'content_item_not_found'; end if;
  if content_status not in ('draft','failed') then
    raise exception 'content_item_not_queueable';
  end if;
  if account_id is null then raise exception 'content_account_missing'; end if;

  insert into public.scheduled_jobs (
    workspace_id, kind, dedupe_key, payload, run_at
  ) values (
    target_workspace_id,
    'content_publish',
    target_dedupe_key,
    jsonb_build_object('contentItemId', target_content_item_id),
    target_run_at
  )
  on conflict (workspace_id, dedupe_key) do update
    set payload = excluded.payload,
        run_at = excluded.run_at,
        status = case
          when public.scheduled_jobs.status in ('failed','blocked') then 'pending'
          else public.scheduled_jobs.status
        end,
        attempts = case
          when public.scheduled_jobs.status in ('failed','blocked') then 0
          else public.scheduled_jobs.attempts
        end,
        last_error = case
          when public.scheduled_jobs.status in ('failed','blocked') then null
          else public.scheduled_jobs.last_error
        end,
        locked_at = case
          when public.scheduled_jobs.status in ('failed','blocked') then null
          else public.scheduled_jobs.locked_at
        end
  returning id into job_id;

  update public.content_items
  set status = 'scheduled',
      scheduled_at = target_run_at,
      publish_error_code = null
  where id = target_content_item_id
    and workspace_id = target_workspace_id;

  return job_id;
end;
$$;

revoke all on function public.enqueue_content_publish(uuid,uuid,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_content_publish(uuid,uuid,timestamptz,text)
  to service_role;

comment on function public.enqueue_content_publish(uuid,uuid,timestamptz,text) is
  'Enfileira e marca conteúdo como agendado na mesma transação.';
comment on table public.auto_like_settings is
  'Preferência de auto-like; capability_supported permanece false enquanto a API oficial não oferecer curtida de comentário.';
