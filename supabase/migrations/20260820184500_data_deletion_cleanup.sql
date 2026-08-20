-- Wal Chat — exclusão Meta completa: elimina payloads e referências indiretas.

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

comment on function public.process_meta_data_deletion(text, text) is
  'Exclui dados Meta e referências indiretas por identificador externo.';
