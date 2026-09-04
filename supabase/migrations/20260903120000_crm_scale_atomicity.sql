-- Wal Chat — CRM escalável e comandos atômicos.
-- As funções são exclusivas do service_role: o workspace informado só é
-- aceito depois que a API autenticada resolve a associação do usuário.

create index if not exists crm_leads_pipeline_updated_idx
  on public.crm_leads (workspace_id, pipeline_id, updated_at desc, id);
create index if not exists crm_leads_pipeline_status_idx
  on public.crm_leads (workspace_id, pipeline_id, status, stage_id, position_in_stage);
create index if not exists crm_leads_tags_gin_idx
  on public.crm_leads using gin (tags);

create or replace function public.crm_list_leads(
  target_workspace_id uuid,
  target_pipeline_id uuid,
  target_page integer default 1,
  target_page_size integer default 100,
  target_query text default null,
  target_owner_id uuid default null,
  target_unassigned boolean default false,
  target_status text default null,
  target_risk text default null,
  target_tag text default null,
  target_sort text default 'position'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if target_page < 1 or target_page_size < 1 or target_page_size > 200 then
    raise exception 'invalid_crm_pagination' using errcode = '22023';
  end if;

  with filtered as (
    select
      lead.*,
      contact.display_name,
      contact.full_name,
      contact.username,
      contact.phone,
      contact.email,
      contact.avatar_url,
      contact.platform as contact_platform,
      contact.company,
      contact.job_title,
      score.probability,
      score.reason as score_reason,
      score.band,
      risk.bucket,
      risk.since as risk_since,
      stage.position as stage_position
    from public.crm_leads lead
    join public.crm_stages stage
      on stage.id = lead.stage_id
      and stage.pipeline_id = lead.pipeline_id
      and stage.workspace_id = lead.workspace_id
    left join public.contacts contact
      on contact.id = lead.contact_id
      and contact.workspace_id = lead.workspace_id
    left join public.crm_lead_scores score
      on score.lead_id = lead.id
      and score.workspace_id = lead.workspace_id
    left join public.crm_lead_risk_states risk
      on risk.lead_id = lead.id
      and risk.workspace_id = lead.workspace_id
    where lead.workspace_id = target_workspace_id
      and lead.pipeline_id = target_pipeline_id
      and (target_owner_id is null or lead.owner_user_id = target_owner_id)
      and (not target_unassigned or lead.owner_user_id is null)
      and (target_status is null or lead.status = target_status)
      and (target_risk is null or risk.bucket = target_risk)
      and (target_tag is null or target_tag = any(lead.tags))
      and (
        nullif(btrim(target_query), '') is null
        or lower(concat_ws(' ',
          lead.title,
          lead.description,
          lead.source,
          contact.display_name,
          contact.full_name,
          contact.username,
          contact.email,
          contact.phone,
          contact.company,
          array_to_string(lead.tags, ' '),
          lead.custom_fields::text
        )) like '%' || lower(btrim(target_query)) || '%'
      )
  ), ordered as (
    select *
    from filtered
    order by
      case when target_sort = 'position' then stage_position end asc nulls last,
      case when target_sort = 'position' then position_in_stage end asc nulls last,
      case when target_sort = 'next-action' then next_action_at end asc nulls last,
      case when target_sort = 'value-desc' then value_cents end desc nulls last,
      case when target_sort = 'recent' then updated_at end desc nulls last,
      id asc
  ), paged as (
    select ordered.*, row_number() over () as result_order
    from ordered
    offset (target_page - 1) * target_page_size
    limit target_page_size
  )
  select jsonb_build_object(
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', paged.id,
          'pipelineId', paged.pipeline_id,
          'stageId', paged.stage_id,
          'contactId', paged.contact_id,
          'title', paged.title,
          'description', paged.description,
          'status', paged.status,
          'lostReason', paged.lost_reason,
          'position', paged.position_in_stage,
          'valueCents', paged.value_cents,
          'currency', paged.currency,
          'ownerUserId', paged.owner_user_id,
          'lastActivityAt', paged.last_activity_at,
          'nextActionAt', paged.next_action_at,
          'expectedCloseDate', paged.expected_close_date,
          'source', paged.source,
          'sourceMetadata', paged.source_metadata,
          'customFields', paged.custom_fields,
          'tags', to_jsonb(paged.tags),
          'lockVersion', paged.lock_version,
          'createdAt', paged.created_at,
          'updatedAt', paged.updated_at,
          'contact', case when paged.contact_id is null then null else jsonb_build_object(
            'id', paged.contact_id,
            'display_name', paged.display_name,
            'full_name', paged.full_name,
            'username', paged.username,
            'phone', paged.phone,
            'email', paged.email,
            'avatar_url', paged.avatar_url,
            'platform', paged.contact_platform,
            'company', paged.company,
            'job_title', paged.job_title
          ) end,
          'score', case when paged.probability is null then null else jsonb_build_object(
            'probability', paged.probability,
            'reason', paged.score_reason,
            'band', paged.band
          ) end,
          'risk', case when paged.bucket is null then null else jsonb_build_object(
            'bucket', paged.bucket,
            'since', paged.risk_since
          ) end
        ) order by paged.result_order
      ),
      '[]'::jsonb
    ),
    'total', (select count(*) from filtered),
    'page', target_page,
    'pageSize', target_page_size
  ) into result
  from paged;

  return coalesce(
    result,
    jsonb_build_object(
      'items', '[]'::jsonb,
      'total', 0,
      'page', target_page,
      'pageSize', target_page_size
    )
  );
end;
$$;

create or replace function public.crm_pipeline_summary(
  target_workspace_id uuid,
  target_pipeline_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'open', count(*) filter (where lead.status = 'open'),
    'won', count(*) filter (where lead.status = 'won'),
    'lost', count(*) filter (where lead.status = 'lost'),
    'valueCents', coalesce(sum(lead.value_cents) filter (where lead.status = 'open'), 0),
    'weightedValueCents', coalesce(sum(
      round(coalesce(lead.value_cents, 0) * coalesce(score.probability, 0) / 100)
    ) filter (where lead.status = 'open'), 0),
    'atRisk', count(*) filter (
      where risk.bucket in ('em_risco', 'critico')
    ),
    'overdue', count(*) filter (
      where lead.status = 'open'
        and lead.next_action_at is not null
        and lead.next_action_at < timezone('utc', now())
    ),
    'unassigned', count(*) filter (
      where lead.status = 'open' and lead.owner_user_id is null
    )
  )
  from public.crm_leads lead
  left join public.crm_lead_scores score
    on score.lead_id = lead.id and score.workspace_id = lead.workspace_id
  left join public.crm_lead_risk_states risk
    on risk.lead_id = lead.id and risk.workspace_id = lead.workspace_id
  where lead.workspace_id = target_workspace_id
    and lead.pipeline_id = target_pipeline_id;
$$;

create or replace function public.crm_create_lead_command(
  target_workspace_id uuid,
  actor_user_id uuid,
  lead_data jsonb,
  request_user_agent text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stage_row public.crm_stages%rowtype;
  created_lead public.crm_leads%rowtype;
  contact_probability numeric;
  next_position numeric;
begin
  select * into stage_row
  from public.crm_stages
  where workspace_id = target_workspace_id
    and id = (lead_data->>'stage_id')::uuid
    and pipeline_id = (lead_data->>'pipeline_id')::uuid
    and archived_at is null;
  if not found or stage_row.terminal_state <> 'open' then
    raise exception 'invalid_crm_stage' using errcode = '23514';
  end if;

  if nullif(lead_data->>'contact_id', '') is not null and not exists (
    select 1 from public.contacts
    where workspace_id = target_workspace_id
      and id = (lead_data->>'contact_id')::uuid
  ) then
    raise exception 'invalid_crm_contact' using errcode = '23503';
  end if;

  if nullif(lead_data->>'owner_user_id', '') is not null and not exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = (lead_data->>'owner_user_id')::uuid
  ) then
    raise exception 'invalid_crm_owner' using errcode = '23503';
  end if;

  select coalesce(max(position_in_stage), 0) + 1000 into next_position
  from public.crm_leads
  where workspace_id = target_workspace_id
    and stage_id = stage_row.id;

  insert into public.crm_leads (
    workspace_id, pipeline_id, stage_id, contact_id, title, description,
    value_cents, owner_user_id, assigned_at, expected_close_date,
    next_action_at, source, custom_fields, tags, last_activity_at,
    position_in_stage, created_by_user_id
  ) values (
    target_workspace_id,
    stage_row.pipeline_id,
    stage_row.id,
    nullif(lead_data->>'contact_id', '')::uuid,
    lead_data->>'title',
    nullif(lead_data->>'description', ''),
    nullif(lead_data->>'value_cents', '')::bigint,
    nullif(lead_data->>'owner_user_id', '')::uuid,
    case when nullif(lead_data->>'owner_user_id', '') is null then null else timezone('utc', now()) end,
    nullif(lead_data->>'expected_close_date', '')::date,
    nullif(lead_data->>'next_action_at', '')::timestamptz,
    lead_data->>'source',
    coalesce(lead_data->'custom_fields', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(lead_data->'tags')), '{}'),
    timezone('utc', now()),
    next_position,
    actor_user_id
  ) returning * into created_lead;

  insert into public.crm_lead_activities (
    workspace_id, lead_id, contact_id, activity_type, payload,
    performed_by_user_id
  ) values (
    target_workspace_id,
    created_lead.id,
    created_lead.contact_id,
    'lead_created',
    jsonb_build_object('source', created_lead.source, 'stageId', created_lead.stage_id),
    actor_user_id
  );

  if created_lead.contact_id is not null then
    select lead_score into contact_probability
    from public.contacts
    where workspace_id = target_workspace_id and id = created_lead.contact_id;
    if coalesce(contact_probability, 0) > 0 then
      insert into public.crm_lead_scores (
        lead_id, workspace_id, probability, reason, evidence, band, calculated_at
      ) values (
        created_lead.id,
        target_workspace_id,
        contact_probability,
        'Score inicial herdado dos sinais do contato.',
        jsonb_build_object('contactId', created_lead.contact_id),
        case when contact_probability >= 65 then 'quente'
             when contact_probability >= 35 then 'morno'
             else 'frio' end,
        timezone('utc', now())
      ) on conflict (lead_id) do update set
        probability = excluded.probability,
        reason = excluded.reason,
        evidence = excluded.evidence,
        band = excluded.band,
        calculated_at = excluded.calculated_at,
        updated_at = timezone('utc', now());
    end if;
  end if;

  insert into public.api_audit_log (
    workspace_id, actor_user_id, action, resource_type, resource_id, changes,
    user_agent
  ) values (
    target_workspace_id,
    actor_user_id,
    'lead_created',
    'crm_lead',
    created_lead.id,
    jsonb_build_object('pipelineId', created_lead.pipeline_id, 'stageId', created_lead.stage_id),
    nullif(left(request_user_agent, 500), '')
  );

  return jsonb_build_object(
    'id', created_lead.id,
    'lock_version', created_lead.lock_version
  );
end;
$$;

create or replace function public.crm_update_lead_command(
  target_workspace_id uuid,
  actor_user_id uuid,
  target_lead_id uuid,
  expected_lock_version integer,
  lead_changes jsonb,
  activity_type text,
  activity_details jsonb default '{}'::jsonb,
  request_user_agent text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_lead public.crm_leads%rowtype;
  updated_lead public.crm_leads%rowtype;
begin
  select * into previous_lead
  from public.crm_leads
  where workspace_id = target_workspace_id and id = target_lead_id
  for update;
  if not found then
    raise exception 'crm_lead_not_found' using errcode = 'P0002';
  end if;
  if previous_lead.lock_version <> expected_lock_version then
    raise exception 'crm_lead_conflict' using errcode = '40001';
  end if;

  update public.crm_leads set
    stage_id = case when lead_changes ? 'stage_id' then (lead_changes->>'stage_id')::uuid else stage_id end,
    title = case when lead_changes ? 'title' then lead_changes->>'title' else title end,
    description = case when lead_changes ? 'description' then lead_changes->>'description' else description end,
    contact_id = case when lead_changes ? 'contact_id' then nullif(lead_changes->>'contact_id', '')::uuid else contact_id end,
    owner_user_id = case when lead_changes ? 'owner_user_id' then nullif(lead_changes->>'owner_user_id', '')::uuid else owner_user_id end,
    assigned_at = case when lead_changes ? 'owner_user_id' then
      case when nullif(lead_changes->>'owner_user_id', '') is null then null else timezone('utc', now()) end
      else assigned_at end,
    position_in_stage = case when lead_changes ? 'position_in_stage' then (lead_changes->>'position_in_stage')::numeric else position_in_stage end,
    value_cents = case when lead_changes ? 'value_cents' then nullif(lead_changes->>'value_cents', '')::bigint else value_cents end,
    expected_close_date = case when lead_changes ? 'expected_close_date' then nullif(lead_changes->>'expected_close_date', '')::date else expected_close_date end,
    next_action_at = case when lead_changes ? 'next_action_at' then nullif(lead_changes->>'next_action_at', '')::timestamptz else next_action_at end,
    source = case when lead_changes ? 'source' then lead_changes->>'source' else source end,
    tags = case when lead_changes ? 'tags' then array(select jsonb_array_elements_text(lead_changes->'tags')) else tags end,
    custom_fields = case when lead_changes ? 'custom_fields' then lead_changes->'custom_fields' else custom_fields end,
    status = case when lead_changes ? 'status' then lead_changes->>'status' else status end,
    closed_at = case when lead_changes ? 'closed_at' then nullif(lead_changes->>'closed_at', '')::timestamptz else closed_at end,
    lost_reason = case when lead_changes ? 'lost_reason' then lead_changes->>'lost_reason' else lost_reason end,
    last_activity_at = case when lead_changes ? 'last_activity_at' then (lead_changes->>'last_activity_at')::timestamptz else last_activity_at end
  where workspace_id = target_workspace_id
    and id = target_lead_id
    and lock_version = expected_lock_version
  returning * into updated_lead;
  if not found then
    raise exception 'crm_lead_conflict' using errcode = '40001';
  end if;

  insert into public.crm_lead_activities (
    workspace_id, lead_id, contact_id, activity_type, payload,
    performed_by_user_id
  ) values (
    target_workspace_id,
    updated_lead.id,
    updated_lead.contact_id,
    activity_type,
    jsonb_build_object(
      'before', to_jsonb(previous_lead),
      'after', to_jsonb(updated_lead)
    ) || coalesce(activity_details, '{}'::jsonb),
    actor_user_id
  );

  insert into public.api_audit_log (
    workspace_id, actor_user_id, action, resource_type, resource_id, changes,
    user_agent
  ) values (
    target_workspace_id,
    actor_user_id,
    activity_type,
    'crm_lead',
    updated_lead.id,
    jsonb_build_object('before', to_jsonb(previous_lead), 'after', to_jsonb(updated_lead)),
    nullif(left(request_user_agent, 500), '')
  );

  return jsonb_build_object(
    'id', updated_lead.id,
    'stage_id', updated_lead.stage_id,
    'status', updated_lead.status,
    'lock_version', updated_lead.lock_version,
    'updated_at', updated_lead.updated_at
  );
end;
$$;

create or replace function public.crm_add_activity_command(
  target_workspace_id uuid,
  actor_user_id uuid,
  target_lead_id uuid,
  activity_kind text,
  activity_payload jsonb,
  request_user_agent text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lead_row public.crm_leads%rowtype;
  activity_row public.crm_lead_activities%rowtype;
begin
  select * into lead_row
  from public.crm_leads
  where workspace_id = target_workspace_id and id = target_lead_id
  for update;
  if not found then
    raise exception 'crm_lead_not_found' using errcode = 'P0002';
  end if;

  insert into public.crm_lead_activities (
    workspace_id, lead_id, contact_id, activity_type, payload,
    performed_by_user_id
  ) values (
    target_workspace_id,
    lead_row.id,
    lead_row.contact_id,
    activity_kind,
    activity_payload,
    actor_user_id
  ) returning * into activity_row;

  update public.crm_leads
  set last_activity_at = activity_row.performed_at
  where workspace_id = target_workspace_id and id = lead_row.id;

  insert into public.api_audit_log (
    workspace_id, actor_user_id, action, resource_type, resource_id, changes,
    user_agent
  ) values (
    target_workspace_id,
    actor_user_id,
    'lead_activity_created',
    'crm_lead',
    lead_row.id,
    jsonb_build_object('activityType', activity_kind),
    nullif(left(request_user_agent, 500), '')
  );

  return jsonb_build_object(
    'id', activity_row.id,
    'type', activity_row.activity_type,
    'payload', activity_row.payload,
    'performedAt', activity_row.performed_at
  );
end;
$$;

create or replace function public.crm_bulk_update_leads(
  target_workspace_id uuid,
  actor_user_id uuid,
  target_lead_ids uuid[],
  target_versions jsonb,
  command_kind text,
  target_stage_id uuid default null,
  target_owner_id uuid default null,
  target_lost_reason text default null,
  request_user_agent text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_count integer;
  stage_row public.crm_stages%rowtype;
  resulting_status text;
  previous_state jsonb;
  updated_state jsonb;
begin
  if coalesce(array_length(target_lead_ids, 1), 0) < 1
     or array_length(target_lead_ids, 1) > 100 then
    raise exception 'invalid_crm_bulk_size' using errcode = '22023';
  end if;
  if command_kind not in ('move', 'assign') then
    raise exception 'invalid_crm_bulk_command' using errcode = '22023';
  end if;

  perform 1 from public.crm_leads
  where workspace_id = target_workspace_id and id = any(target_lead_ids)
  for update;

  select count(*), jsonb_agg(jsonb_build_object(
    'id', id,
    'stageId', stage_id,
    'ownerUserId', owner_user_id,
    'status', status,
    'lostReason', lost_reason,
    'position', position_in_stage,
    'lockVersion', lock_version
  )) into selected_count, previous_state
  from public.crm_leads
  where workspace_id = target_workspace_id and id = any(target_lead_ids);
  if selected_count <> array_length(target_lead_ids, 1) then
    raise exception 'crm_bulk_lead_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.crm_leads
    where workspace_id = target_workspace_id
      and id = any(target_lead_ids)
      and lock_version <> coalesce(
        nullif(target_versions->>id::text, '')::integer,
        -1
      )
  ) then
    raise exception 'crm_lead_conflict' using errcode = '40001';
  end if;

  if command_kind = 'move' then
    select * into stage_row from public.crm_stages
    where workspace_id = target_workspace_id
      and id = target_stage_id
      and archived_at is null;
    if not found or exists (
      select 1 from public.crm_leads
      where workspace_id = target_workspace_id
        and id = any(target_lead_ids)
        and pipeline_id <> stage_row.pipeline_id
    ) then
      raise exception 'invalid_crm_bulk_stage' using errcode = '23514';
    end if;
    resulting_status := stage_row.terminal_state;
    if resulting_status = 'lost' and nullif(btrim(target_lost_reason), '') is null then
      raise exception 'crm_lost_reason_required' using errcode = '23514';
    end if;

    update public.crm_leads lead set
      stage_id = stage_row.id,
      status = resulting_status,
      closed_at = case when resulting_status = 'open' then null else timezone('utc', now()) end,
      lost_reason = case when resulting_status = 'lost' then btrim(target_lost_reason) else null end,
      last_activity_at = timezone('utc', now()),
      position_in_stage = coalesce((
        select max(other.position_in_stage)
        from public.crm_leads other
        where other.workspace_id = target_workspace_id
          and other.stage_id = stage_row.id
          and not (other.id = any(target_lead_ids))
      ), 0) + 1000 + array_position(target_lead_ids, lead.id)
    where lead.workspace_id = target_workspace_id
      and lead.id = any(target_lead_ids);
  else
    if target_owner_id is not null and not exists (
      select 1 from public.workspace_members
      where workspace_id = target_workspace_id and user_id = target_owner_id
    ) then
      raise exception 'invalid_crm_bulk_owner' using errcode = '23503';
    end if;
    update public.crm_leads set
      owner_user_id = target_owner_id,
      assigned_at = case when target_owner_id is null then null else timezone('utc', now()) end,
      last_activity_at = timezone('utc', now())
    where workspace_id = target_workspace_id and id = any(target_lead_ids);
  end if;

  insert into public.crm_lead_activities (
    workspace_id, lead_id, contact_id, activity_type, payload,
    performed_by_user_id
  )
  select
    target_workspace_id,
    lead.id,
    lead.contact_id,
    case when command_kind = 'move' then 'stage_moved' else 'lead_assigned' end,
    case when command_kind = 'move'
      then jsonb_build_object('toStageId', target_stage_id, 'bulk', true)
      else jsonb_build_object('ownerUserId', target_owner_id, 'bulk', true)
    end,
    actor_user_id
  from public.crm_leads lead
  where lead.workspace_id = target_workspace_id and lead.id = any(target_lead_ids);

  select jsonb_agg(jsonb_build_object(
    'id', id,
    'stageId', stage_id,
    'ownerUserId', owner_user_id,
    'status', status,
    'lostReason', lost_reason,
    'position', position_in_stage,
    'lockVersion', lock_version
  )) into updated_state
  from public.crm_leads
  where workspace_id = target_workspace_id and id = any(target_lead_ids);

  insert into public.api_audit_log (
    workspace_id, actor_user_id, action, resource_type, changes, user_agent
  ) values (
    target_workspace_id,
    actor_user_id,
    'crm_bulk_' || command_kind,
    'crm_lead',
    jsonb_build_object(
      'leadIds', to_jsonb(target_lead_ids),
      'before', coalesce(previous_state, '[]'::jsonb),
      'after', coalesce(updated_state, '[]'::jsonb)
    ),
    nullif(left(request_user_agent, 500), '')
  );

  return jsonb_build_object(
    'count', selected_count,
    'before', coalesce(previous_state, '[]'::jsonb),
    'after', coalesce(updated_state, '[]'::jsonb)
  );
end;
$$;

create or replace function public.crm_import_leads_command(
  target_workspace_id uuid,
  actor_user_id uuid,
  target_pipeline_id uuid,
  target_stage_id uuid,
  rows jsonb,
  request_user_agent text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  created jsonb;
  created_ids jsonb := '[]'::jsonb;
  row_count integer := 0;
begin
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) < 1
     or jsonb_array_length(rows) > 200 then
    raise exception 'invalid_crm_import_size' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(rows)
  loop
    created := public.crm_create_lead_command(
      target_workspace_id,
      actor_user_id,
      item || jsonb_build_object(
        'pipeline_id', target_pipeline_id,
        'stage_id', target_stage_id
      ),
      request_user_agent
    );
    created_ids := created_ids || jsonb_build_array(created->'id');
    row_count := row_count + 1;
  end loop;

  insert into public.api_audit_log (
    workspace_id, actor_user_id, action, resource_type, changes, user_agent
  ) values (
    target_workspace_id,
    actor_user_id,
    'crm_leads_imported',
    'crm_lead',
    jsonb_build_object('count', row_count, 'leadIds', created_ids),
    nullif(left(request_user_agent, 500), '')
  );
  return jsonb_build_object('count', row_count, 'leadIds', created_ids);
end;
$$;

create or replace function public.crm_create_pipeline_command(
  target_workspace_id uuid,
  actor_user_id uuid,
  pipeline_data jsonb,
  request_user_agent text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pipeline_row public.crm_pipelines%rowtype;
  next_position numeric;
begin
  select coalesce(max(position), 0) + 1000 into next_position
  from public.crm_pipelines
  where workspace_id = target_workspace_id and archived_at is null;

  insert into public.crm_pipelines (
    workspace_id, name, slug, description, position
  ) values (
    target_workspace_id,
    pipeline_data->>'name',
    pipeline_data->>'slug',
    nullif(pipeline_data->>'description', ''),
    next_position
  ) returning * into pipeline_row;

  insert into public.crm_stages (
    workspace_id, pipeline_id, name, slug, position, color,
    terminal_state, expected_duration_hours
  ) values
    (target_workspace_id, pipeline_row.id, 'Novo lead', 'novo', 1000, '#3B82F6', 'open', 24),
    (target_workspace_id, pipeline_row.id, 'Em andamento', 'em-andamento', 2000, '#F59E0B', 'open', 72),
    (target_workspace_id, pipeline_row.id, 'Ganho', 'ganho', 3000, '#16A34A', 'won', 720),
    (target_workspace_id, pipeline_row.id, 'Perdido', 'perdido', 4000, '#6B7280', 'lost', 720);

  insert into public.api_audit_log (
    workspace_id, actor_user_id, action, resource_type, resource_id, changes,
    user_agent
  ) values (
    target_workspace_id,
    actor_user_id,
    'pipeline_created',
    'crm_pipeline',
    pipeline_row.id,
    jsonb_build_object('name', pipeline_row.name),
    nullif(left(request_user_agent, 500), '')
  );

  return jsonb_build_object('id', pipeline_row.id);
end;
$$;

create or replace function public.crm_reorder_stages_command(
  target_workspace_id uuid,
  actor_user_id uuid,
  target_pipeline_id uuid,
  target_stage_ids uuid[],
  request_user_agent text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_stage_ids uuid[];
begin
  perform 1
  from public.crm_stages stage
  where stage.workspace_id = target_workspace_id
    and stage.pipeline_id = target_pipeline_id
    and stage.archived_at is null
  for update;

  select array_agg(stage.id order by stage.id) into active_stage_ids
  from public.crm_stages stage
  where stage.workspace_id = target_workspace_id
    and stage.pipeline_id = target_pipeline_id
    and stage.archived_at is null;

  if active_stage_ids is null
     or array_length(target_stage_ids, 1) is distinct from array_length(active_stage_ids, 1)
     or (select array_agg(item order by item) from unnest(target_stage_ids) item)
        is distinct from active_stage_ids then
    raise exception 'invalid_crm_stage_order' using errcode = '22023';
  end if;

  update public.crm_stages stage
  set position = ordered.ordinality * 1000,
      updated_at = timezone('utc', now())
  from unnest(target_stage_ids) with ordinality as ordered(id, ordinality)
  where stage.workspace_id = target_workspace_id
    and stage.pipeline_id = target_pipeline_id
    and stage.id = ordered.id;

  insert into public.api_audit_log (
    workspace_id, actor_user_id, action, resource_type, resource_id, changes,
    user_agent
  ) values (
    target_workspace_id,
    actor_user_id,
    'crm_stages_reordered',
    'crm_pipeline',
    target_pipeline_id,
    jsonb_build_object('stageIds', to_jsonb(target_stage_ids)),
    nullif(left(request_user_agent, 500), '')
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.crm_list_leads(uuid, uuid, integer, integer, text, uuid, boolean, text, text, text, text) from public, anon, authenticated;
revoke all on function public.crm_pipeline_summary(uuid, uuid) from public, anon, authenticated;
revoke all on function public.crm_create_lead_command(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.crm_update_lead_command(uuid, uuid, uuid, integer, jsonb, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.crm_add_activity_command(uuid, uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.crm_bulk_update_leads(uuid, uuid, uuid[], jsonb, text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_import_leads_command(uuid, uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.crm_create_pipeline_command(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.crm_reorder_stages_command(uuid, uuid, uuid, uuid[], text) from public, anon, authenticated;

grant execute on function public.crm_list_leads(uuid, uuid, integer, integer, text, uuid, boolean, text, text, text, text) to service_role;
grant execute on function public.crm_pipeline_summary(uuid, uuid) to service_role;
grant execute on function public.crm_create_lead_command(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.crm_update_lead_command(uuid, uuid, uuid, integer, jsonb, text, jsonb, text) to service_role;
grant execute on function public.crm_add_activity_command(uuid, uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.crm_bulk_update_leads(uuid, uuid, uuid[], jsonb, text, uuid, uuid, text, text) to service_role;
grant execute on function public.crm_import_leads_command(uuid, uuid, uuid, uuid, jsonb, text) to service_role;
grant execute on function public.crm_create_pipeline_command(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.crm_reorder_stages_command(uuid, uuid, uuid, uuid[], text) to service_role;

comment on function public.crm_list_leads(uuid, uuid, integer, integer, text, uuid, boolean, text, text, text, text) is
  'Busca paginada do CRM com filtros aplicados no banco e payload pronto para o board.';
comment on function public.crm_create_lead_command(uuid, uuid, jsonb, text) is
  'Cria lead, atividade, score inicial e auditoria na mesma transação.';
comment on function public.crm_update_lead_command(uuid, uuid, uuid, integer, jsonb, text, jsonb, text) is
  'Atualiza lead com lock otimista, atividade e auditoria na mesma transação.';
comment on function public.crm_add_activity_command(uuid, uuid, uuid, text, jsonb, text) is
  'Registra atividade, toca o lead e audita na mesma transação.';
comment on function public.crm_bulk_update_leads(uuid, uuid, uuid[], jsonb, text, uuid, uuid, text, text) is
  'Move ou atribui até cem leads com atividades e auditoria atômicas.';
comment on function public.crm_import_leads_command(uuid, uuid, uuid, uuid, jsonb, text) is
  'Importa até duzentos leads em uma única transação.';
comment on function public.crm_create_pipeline_command(uuid, uuid, jsonb, text) is
  'Cria pipeline, etapas padrão e auditoria na mesma transação.';
comment on function public.crm_reorder_stages_command(uuid, uuid, uuid, uuid[], text) is
  'Reordena todas as etapas e registra auditoria na mesma transação.';
