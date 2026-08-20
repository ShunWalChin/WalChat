-- Recompila a ingestão com resolução explícita de nomes. Os nomes do contrato
-- RETURNS TABLE coincidem intencionalmente com colunas e devem preferir coluna.
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
