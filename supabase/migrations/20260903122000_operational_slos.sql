-- Wal Chat — indicadores operacionais agregados por workspace e janela de 24h.

create table if not exists public.operational_alert_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  status text not null check (status in ('pass', 'warning', 'fail')),
  fingerprint text not null check (char_length(fingerprint) between 1 and 500),
  last_notified_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.operational_alert_state enable row level security;

revoke all on table public.operational_alert_state from public, anon, authenticated;
grant select, insert, update, delete on table public.operational_alert_state to service_role;

create or replace function public.workspace_operational_slos(
  target_workspace_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with job_metrics as (
    select
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours') as total,
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours' and status = 'completed') as completed,
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours' and status in ('failed', 'blocked')) as failed,
      count(*) filter (where status in ('pending', 'processing')) as backlog,
      extract(epoch from (timezone('utc', now()) - min(run_at) filter (where status = 'pending'))) / 60 as oldest_minutes
    from public.scheduled_jobs
    where workspace_id = target_workspace_id
  ), webhook_metrics as (
    select
      count(*) filter (where received_at >= timezone('utc', now()) - interval '24 hours') as total,
      count(*) filter (where received_at >= timezone('utc', now()) - interval '24 hours' and status in ('processed', 'ignored')) as completed,
      count(*) filter (where received_at >= timezone('utc', now()) - interval '24 hours' and status = 'failed') as failed,
      count(*) filter (where status in ('queued', 'processing')) as backlog,
      extract(epoch from (timezone('utc', now()) - min(received_at) filter (where status = 'queued'))) / 60 as oldest_minutes
    from public.webhook_events
    where workspace_id = target_workspace_id
  ), ai_metrics as (
    select
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours') as total,
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours' and status = 'completed') as completed,
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours' and status in ('failed', 'blocked')) as failed,
      count(*) filter (where status = 'running') as backlog,
      percentile_cont(0.95) within group (order by latency_ms)
        filter (where created_at >= timezone('utc', now()) - interval '24 hours' and latency_ms is not null) as p95_latency_ms
    from public.ai_execution_log
    where workspace_id = target_workspace_id
  ), conversion_metrics as (
    select
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours') as total,
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours' and status in ('completed', 'partial')) as completed,
      count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours' and status in ('failed', 'blocked')) as failed,
      count(*) filter (where status in ('pending', 'processing')) as backlog,
      extract(epoch from (timezone('utc', now()) - min(event_time) filter (where status = 'pending'))) / 60 as oldest_minutes
    from public.ad_conversion_events
    where workspace_id = target_workspace_id
  ), services as (
    select * from (values
      ('scheduler', 'Jobs agendados', 98::numeric,
        (select total from job_metrics), (select completed from job_metrics),
        (select failed from job_metrics), (select backlog from job_metrics),
        (select oldest_minutes from job_metrics), null::numeric),
      ('webhooks', 'Webhooks Meta', 99::numeric,
        (select total from webhook_metrics), (select completed from webhook_metrics),
        (select failed from webhook_metrics), (select backlog from webhook_metrics),
        (select oldest_minutes from webhook_metrics), null::numeric),
      ('ai', 'Execuções de IA', 95::numeric,
        (select total from ai_metrics), (select completed from ai_metrics),
        (select failed from ai_metrics), (select backlog from ai_metrics),
        null::numeric, (select p95_latency_ms from ai_metrics)),
      ('conversions', 'Conversões OCI/CAPI', 95::numeric,
        (select total from conversion_metrics), (select completed from conversion_metrics),
        (select failed from conversion_metrics), (select backlog from conversion_metrics),
        (select oldest_minutes from conversion_metrics), null::numeric)
    ) as values_table(id, label, target_rate, total, completed, failed, backlog, oldest_minutes, p95_latency_ms)
  ), calculated as (
    select *,
      case when total = 0 then null
        else round(completed::numeric * 100 / total, 2) end as success_rate,
      case
        when failed >= 5 or backlog >= 50 or coalesce(oldest_minutes, 0) >= 30 then 'fail'
        when failed > 0 or backlog >= 10 or coalesce(oldest_minutes, 0) >= 10 then 'warning'
        else 'pass'
      end as status
    from services
  )
  select jsonb_build_object(
    'windowHours', 24,
    'generatedAt', timezone('utc', now()),
    'overall', case
      when count(*) filter (where status = 'fail') > 0 then 'fail'
      when count(*) filter (where status = 'warning') > 0 then 'warning'
      else 'pass'
    end,
    'services', jsonb_agg(jsonb_build_object(
      'id', id,
      'label', label,
      'status', status,
      'targetRate', target_rate,
      'successRate', success_rate,
      'total', total,
      'completed', completed,
      'failed', failed,
      'backlog', backlog,
      'oldestMinutes', case when oldest_minutes is null then null else round(oldest_minutes, 1) end,
      'p95LatencyMs', case when p95_latency_ms is null then null else round(p95_latency_ms) end
    ) order by id)
  )
  from calculated;
$$;

revoke all on function public.workspace_operational_slos(uuid)
  from public, anon, authenticated;
grant execute on function public.workspace_operational_slos(uuid)
  to service_role;

comment on function public.workspace_operational_slos(uuid) is
  'SLOs sanitizados de scheduler, webhooks, IA e conversões, agregados por workspace.';

comment on table public.operational_alert_state is
  'Estado mínimo de deduplicação dos alertas externos, sem payloads nem PII.';
