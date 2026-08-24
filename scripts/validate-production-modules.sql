-- Asserções pós-migration dos módulos que saíram do estado de protótipo.
-- O bloco inteiro é revertido: nenhum usuário, workspace, job ou conteúdo de QA
-- permanece no banco usado pelo ensaio.
begin;

do $$
declare
  qa_user_id uuid := gen_random_uuid();
  qa_workspace_id uuid := gen_random_uuid();
  qa_account_id uuid := gen_random_uuid();
  qa_content_id uuid := gen_random_uuid();
  qa_sequence_id uuid;
  qa_job_id uuid;
  row_count integer;
  rls_enabled boolean;
begin
  if not exists (
    select 1
    from unnest(enum_range(null::public.sequence_step_kind)) value
    where value::text = 'delay'
  ) then
    raise exception 'missing_sequence_delay_enum';
  end if;

  select relrowsecurity into rls_enabled
  from pg_class
  where oid = 'public.auto_like_settings'::regclass;
  if not rls_enabled then raise exception 'auto_like_rls_disabled'; end if;

  if has_function_privilege(
    'authenticated',
    'public.save_sequence_definition(uuid,uuid,text,text,boolean,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'sequence_rpc_exposed_to_authenticated';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.enqueue_content_publish(uuid,uuid,timestamptz,text)',
    'EXECUTE'
  ) then
    raise exception 'content_rpc_exposed_to_authenticated';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    qa_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'walchat-migration-check@example.invalid',
    '',
    timezone('utc', now()),
    '{}'::jsonb,
    '{}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now())
  );
  insert into public.workspaces (id, owner_id, name, slug)
  values (qa_workspace_id, qa_user_id, 'Wal Chat QA', 'wal-chat-migration-check');
  insert into public.instagram_accounts (
    id, workspace_id, instagram_user_id, username, account_type, scopes
  ) values (
    qa_account_id,
    qa_workspace_id,
    'qa-instagram-user',
    'walchat_qa',
    'BUSINESS',
    array['instagram_business_content_publish']
  );

  qa_sequence_id := public.save_sequence_definition(
    qa_workspace_id,
    null,
    'Sequência de QA',
    'Validação transacional',
    false,
    '[{"kind":"delay","delaySeconds":60},{"kind":"text","content":"Olá"}]'::jsonb
  );
  select count(*) into row_count
  from public.sequence_steps
  where sequence_id = qa_sequence_id;
  if row_count <> 2 then raise exception 'sequence_steps_not_saved'; end if;

  insert into public.content_items (
    id, workspace_id, instagram_account_id, kind, title, media
  ) values (
    qa_content_id,
    qa_workspace_id,
    qa_account_id,
    'feed',
    'Conteúdo de QA',
    '[{"url":"https://example.invalid/qa.jpg","type":"image"}]'::jsonb
  );
  qa_job_id := public.enqueue_content_publish(
    qa_workspace_id,
    qa_content_id,
    timezone('utc', now()) + interval '10 minutes',
    'content:qa:publish:20260824'
  );
  if qa_job_id is null then raise exception 'content_job_not_created'; end if;
  if not exists (
    select 1 from public.content_items
    where id = qa_content_id and status = 'scheduled'
  ) then
    raise exception 'content_not_marked_scheduled';
  end if;
  if not exists (
    select 1 from public.scheduled_jobs
    where id = qa_job_id
      and workspace_id = qa_workspace_id
      and kind = 'content_publish'
      and status = 'pending'
  ) then
    raise exception 'content_job_invalid';
  end if;

  insert into public.auto_like_settings (workspace_id)
  values (qa_workspace_id);
  if exists (
    select 1 from public.auto_like_settings
    where workspace_id = qa_workspace_id and capability_supported
  ) then
    raise exception 'unsupported_auto_like_enabled';
  end if;
end;
$$;

rollback;
