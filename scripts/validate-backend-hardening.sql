-- Validação transacional pós-migration. Tudo é revertido ao final.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if has_table_privilege('authenticated', 'public.workspace_members', 'UPDATE') then
    raise exception 'authenticated_can_update_workspace_members';
  end if;
  if has_table_privilege('authenticated', 'public.contacts', 'INSERT') then
    raise exception 'authenticated_can_insert_contacts';
  end if;
  if has_table_privilege('authenticated', 'public.messages', 'UPDATE') then
    raise exception 'authenticated_can_update_messages';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.ingest_instagram_inbound(uuid,uuid,text,text,text,public.interaction_channel,text,jsonb,timestamptz,boolean)',
    'EXECUTE'
  ) then
    raise exception 'authenticated_can_execute_inbound_rpc';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_members'
      and policyname = 'members_manage'
  ) then
    raise exception 'members_manage_policy_still_exists';
  end if;
end;
$$;

do $$
declare
  target_workspace uuid;
  target_account uuid;
  target_contact uuid;
  target_interaction uuid;
  unread_total integer;
  interaction_total integer;
  message_total integer;
  deletion_result public.data_deletion_requests;
begin
  select id into target_workspace from public.workspaces order by created_at limit 1;
  if target_workspace is null then
    raise exception 'validation_requires_one_workspace';
  end if;

  insert into public.instagram_accounts (
    workspace_id, instagram_user_id, username, status
  ) values (
    target_workspace, 'hardening-validation-user', 'hardening_validation', 'connected'
  ) returning id into target_account;

  perform * from public.ingest_instagram_inbound(
    target_workspace,
    target_account,
    'hardening-validation-contact',
    'hardening_contact',
    'hardening-event-1',
    'dm'::public.interaction_channel,
    'Mensagem de validação',
    '{"validation":true}'::jsonb,
    timezone('utc', now()),
    true
  );
  perform * from public.ingest_instagram_inbound(
    target_workspace,
    target_account,
    'hardening-validation-contact',
    'hardening_contact',
    'hardening-event-1',
    'dm'::public.interaction_channel,
    'Mensagem de validação',
    '{"validation":true}'::jsonb,
    timezone('utc', now()),
    true
  );

  select id into target_contact from public.contacts
  where workspace_id = target_workspace
    and instagram_user_id = 'hardening-validation-contact';
  select id into target_interaction from public.interactions_log
  where workspace_id = target_workspace and meta_event_id = 'hardening-event-1';
  select count(*) into interaction_total from public.interactions_log
  where workspace_id = target_workspace and meta_event_id = 'hardening-event-1';
  select count(*) into message_total from public.messages
  where workspace_id = target_workspace and contact_id = target_contact;
  select unread_count into unread_total from public.conversations
  where workspace_id = target_workspace and contact_id = target_contact;

  if interaction_total <> 1 or message_total <> 1 or unread_total <> 1 then
    raise exception 'inbound_idempotency_failed interactions=% messages=% unread=%',
      interaction_total, message_total, unread_total;
  end if;

  insert into public.webhook_events (
    meta_event_key, instagram_user_id, workspace_id, payload, signature_valid
  ) values (
    'hardening-validation-webhook',
    'hardening-validation-user',
    target_workspace,
    '{"entry":[{"id":"hardening-validation-user"}]}'::jsonb,
    true
  );

  insert into public.integration_audit_logs (
    workspace_id, provider, action, status, resource_id, details
  ) values (
    target_workspace,
    'meta',
    'hardening.validation',
    'success',
    target_account::text,
    '{"username":"hardening_validation"}'::jsonb
  );

  insert into public.comment_private_replies (
    workspace_id, instagram_comment_id, contact_id, interaction_id
  ) values (
    target_workspace,
    'hardening-validation-comment',
    target_contact,
    target_interaction
  );

  insert into public.automation_runs (
    workspace_id, contact_id, interaction_id, source, metadata
  ) values (
    target_workspace,
    target_contact,
    target_interaction,
    'dm'::public.trigger_source,
    '{"externalUserId":"hardening-validation-user"}'::jsonb
  );

  insert into public.scheduled_jobs (
    workspace_id, kind, payload, run_at
  ) values (
    target_workspace,
    'sequence_step',
    jsonb_build_object('contactId', target_contact::text),
    timezone('utc', now())
  );

  select * into deletion_result from public.process_meta_data_deletion(
    'hardening-validation-user',
    'hardening-validation-confirmation'
  );
  if deletion_result.status <> 'completed'
    or deletion_result.affected_contacts <> 1
    or deletion_result.affected_accounts <> 1
    or exists (select 1 from public.contacts where id = target_contact)
    or exists (select 1 from public.instagram_accounts where id = target_account)
    or exists (
      select 1 from public.interactions_log
      where meta_event_id = 'hardening-event-1'
    )
    or exists (
      select 1 from public.webhook_events
      where meta_event_key = 'hardening-validation-webhook'
    )
    or exists (
      select 1 from public.integration_audit_logs
      where resource_id = target_account::text
    )
    or exists (
      select 1 from public.comment_private_replies
      where instagram_comment_id = 'hardening-validation-comment'
    )
    or exists (
      select 1 from public.automation_runs
      where contact_id = target_contact or interaction_id = target_interaction
    )
    or exists (
      select 1 from public.scheduled_jobs
      where payload ->> 'contactId' = target_contact::text
    ) then
    raise exception 'data_deletion_validation_failed';
  end if;
end;
$$;

rollback;
