-- Wal Chat - compliance multicanal, status monotônico e exclusão Meta completa.

create or replace view public.contact_messaging_eligibility
with (security_invoker = true) as
select
  c.id as contact_id,
  c.workspace_id,
  c.opted_out_at,
  c.last_inbound_at,
  case
    when c.opted_out_at is not null then 'blocked'::public.window_policy
    when c.last_inbound_at > timezone('utc', now()) - interval '24 hours'
      then 'standard_24h'::public.window_policy
    when c.platform = 'instagram'
      and c.last_inbound_at > timezone('utc', now()) - interval '7 days'
      then 'human_agent_7d'::public.window_policy
    when c.platform = 'whatsapp'
      then 'whatsapp_template'::public.window_policy
    else 'blocked'::public.window_policy
  end as eligibility,
  greatest(
    0,
    extract(epoch from (
      c.last_inbound_at + interval '24 hours' - timezone('utc', now())
    ))::integer
  ) as seconds_left_24h
from public.contacts c;

create or replace view public.meta_activity_daily_last_7_days
with (security_invoker = true) as
select
  interaction.workspace_id,
  (interaction.created_at at time zone 'utc')::date as day,
  count(*) filter (
    where interaction.direction = 'inbound' and interaction.channel = 'dm'
  )::bigint as dms_received,
  count(*) filter (
    where interaction.direction = 'outbound' and interaction.channel = 'dm'
  )::bigint as dms_sent,
  count(*) filter (
    where interaction.direction = 'inbound'
      and interaction.channel = 'comment'
  )::bigint as comments,
  count(*)::bigint as interactions
from public.interactions_log interaction
where interaction.created_at >= timezone('utc', now()) - interval '7 days'
group by interaction.workspace_id, (interaction.created_at at time zone 'utc')::date;

-- Delivery receipts podem chegar fora de ordem. Esta RPC só avança o status e
-- atualiza mensagem, interação e claim de saída na mesma transação.
drop index if exists public.messages_provider_message_idx;
create unique index messages_provider_message_unique
  on public.messages (workspace_id, platform, provider_message_id)
  where provider_message_id is not null;

create or replace function public.apply_whatsapp_delivery_status(
  target_workspace_id uuid,
  target_provider_message_id text,
  target_status public.message_status,
  target_error_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  resolved_interaction_id uuid;
  resolved_delivery_id uuid;
  final_status public.message_status;
begin
  if target_status not in (
    'sent'::public.message_status,
    'delivered'::public.message_status,
    'read'::public.message_status,
    'failed'::public.message_status
  ) then
    raise exception 'invalid_whatsapp_delivery_status';
  end if;

  update public.messages message
  set status = target_status
  where message.workspace_id = target_workspace_id
    and message.platform = 'whatsapp'
    and message.provider_message_id = target_provider_message_id
    and (
      case message.status
        when 'queued' then 0
        when 'sent' then 1
        when 'delivered' then 2
        when 'read' then 3
        when 'failed' then 4
        when 'blocked' then 4
      end
      <=
      case target_status
        when 'sent' then 1
        when 'delivered' then 2
        when 'read' then 3
        when 'failed' then 4
        else 0
      end
    )
  returning message.interaction_id, message.status
  into resolved_interaction_id, final_status;

  if resolved_interaction_id is null then
    select message.interaction_id, message.status
    into resolved_interaction_id, final_status
    from public.messages message
    where message.workspace_id = target_workspace_id
      and message.platform = 'whatsapp'
      and message.provider_message_id = target_provider_message_id
    limit 1;
  end if;
  if resolved_interaction_id is null then return false; end if;

  update public.interactions_log interaction
  set status = final_status
  where interaction.workspace_id = target_workspace_id
    and interaction.id = resolved_interaction_id
  returning interaction.outbound_delivery_id into resolved_delivery_id;

  if target_status = 'failed'::public.message_status
    and resolved_delivery_id is not null then
    update public.outbound_deliveries delivery
    set status = 'failed',
        last_error_code = coalesce(
          nullif(target_error_code, ''),
          'whatsapp_status_failed'
        ),
        completed_at = coalesce(delivery.completed_at, timezone('utc', now()))
    where delivery.workspace_id = target_workspace_id
      and delivery.id = resolved_delivery_id;
  end if;
  return true;
end;
$$;

revoke all on function public.apply_whatsapp_delivery_status(
  uuid, text, public.message_status, text
) from public, anon, authenticated;
grant execute on function public.apply_whatsapp_delivery_status(
  uuid, text, public.message_status, text
) to service_role;

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
  instagram_account_ids uuid[];
  whatsapp_account_ids uuid[];
  whatsapp_waba_ids text[];
  whatsapp_phone_ids text[];
  affected_contact_ids uuid[];
  affected_enrollment_ids uuid[];
  affected_workspace_ids uuid[];
  deleted_contacts integer := 0;
  deleted_accounts integer := 0;
  deleted_now integer := 0;
begin
  if external_user_id is null
    or char_length(external_user_id) not between 1 and 200 then
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
  into instagram_account_ids
  from public.instagram_accounts account
  where account.instagram_user_id = external_user_id;

  select
    array_agg(account.id),
    array_agg(account.waba_id),
    array_agg(account.phone_number_id)
  into whatsapp_account_ids, whatsapp_waba_ids, whatsapp_phone_ids
  from public.whatsapp_accounts account
  where account.id in (
    select credential.whatsapp_account_id
    from public.integration_credentials credential
    where credential.provider = 'meta'
      and credential.credential_type = 'access_token'
      and credential.whatsapp_account_id is not null
      and credential.metadata ->> 'metaUserId' = external_user_id
  );

  select array_agg(contact.id)
  into affected_contact_ids
  from public.contacts contact
  where contact.instagram_user_id = external_user_id
     or contact.whatsapp_user_id = external_user_id
     or (
       instagram_account_ids is not null
       and contact.instagram_account_id = any(instagram_account_ids)
     )
     or (
       whatsapp_account_ids is not null
       and contact.whatsapp_account_id = any(whatsapp_account_ids)
     );

  select array_agg(distinct source.workspace_id)
  into affected_workspace_ids
  from (
    select account.workspace_id
    from public.instagram_accounts account
    where instagram_account_ids is not null
      and account.id = any(instagram_account_ids)
    union
    select account.workspace_id
    from public.whatsapp_accounts account
    where whatsapp_account_ids is not null
      and account.id = any(whatsapp_account_ids)
    union
    select contact.workspace_id
    from public.contacts contact
    where affected_contact_ids is not null
      and contact.id = any(affected_contact_ids)
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
        or event.external_account_id = external_user_id
        or (
          whatsapp_waba_ids is not null
          and event.whatsapp_business_account_id = any(whatsapp_waba_ids)
        )
        or (
          whatsapp_phone_ids is not null
          and event.whatsapp_phone_number_id = any(whatsapp_phone_ids)
        )
        or position(external_user_id in event.payload::text) > 0
      );
  end if;

  delete from public.integration_audit_logs audit
  where (
    instagram_account_ids is not null
    and audit.resource_id in (
      select account_id::text from unnest(instagram_account_ids) account_id
    )
  ) or (
    whatsapp_account_ids is not null
    and audit.resource_id in (
      select account_id::text from unnest(whatsapp_account_ids) account_id
    )
  );

  if instagram_account_ids is not null then
    delete from public.instagram_accounts account
    where account.id = any(instagram_account_ids);
    get diagnostics deleted_now = row_count;
    deleted_accounts := deleted_accounts + deleted_now;
  end if;
  if whatsapp_account_ids is not null then
    delete from public.whatsapp_accounts account
    where account.id = any(whatsapp_account_ids);
    get diagnostics deleted_now = row_count;
    deleted_accounts := deleted_accounts + deleted_now;
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

comment on function public.apply_whatsapp_delivery_status(
  uuid, text, public.message_status, text
) is 'Aplica delivery receipts do WhatsApp sem regressão de status.';
comment on function public.process_meta_data_deletion(text, text) is
  'Exclui dados e contas Instagram/WhatsApp vinculados ao usuário Meta.';
comment on view public.meta_activity_daily_last_7_days is
  'Agregação exata de mensagens e comentários Meta dos últimos sete dias.';
