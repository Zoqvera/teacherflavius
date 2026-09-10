create table if not exists private.system_synthetic_probe_results (
  id uuid primary key default gen_random_uuid(),
  target_key text not null check (target_key ~ '^[a-z0-9_:-]{1,80}$'),
  target_url text not null check (char_length(target_url) between 1 and 500),
  ok boolean not null,
  http_status integer check (http_status is null or http_status between 100 and 599),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 120000),
  error_code text check (error_code is null or char_length(error_code) <= 160),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists system_synthetic_probe_target_checked_idx
  on private.system_synthetic_probe_results (target_key, checked_at desc);
create index if not exists system_synthetic_probe_checked_idx
  on private.system_synthetic_probe_results (checked_at desc);

create table if not exists private.system_health_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('healthy', 'degraded', 'critical')),
  issue_count integer not null default 0 check (issue_count >= 0),
  critical_count integer not null default 0 check (critical_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now()
);

create index if not exists system_health_runs_completed_idx
  on private.system_health_runs (completed_at desc);

create table if not exists private.system_health_alerts (
  id uuid primary key default gen_random_uuid(),
  issue_code text not null check (issue_code ~ '^[a-z0-9_:-]{1,120}$'),
  severity text not null check (severity in ('warning', 'critical')),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 240),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  last_attempt_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists system_health_alerts_status_created_idx
  on private.system_health_alerts (status, created_at desc);
create index if not exists system_health_alerts_issue_created_idx
  on private.system_health_alerts (issue_code, created_at desc);

revoke all on private.system_synthetic_probe_results from public, anon, authenticated;
revoke all on private.system_health_runs from public, anon, authenticated;
revoke all on private.system_health_alerts from public, anon, authenticated;
grant select, insert, update, delete on private.system_synthetic_probe_results to service_role;
grant select, insert, update, delete on private.system_health_runs to service_role;
grant select, insert, update, delete on private.system_health_alerts to service_role;

create or replace function private.enqueue_system_health_alert(
  target_issue_code text,
  target_severity text,
  target_dedupe_key text,
  target_details jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_id uuid;
begin
  insert into private.system_health_alerts (issue_code, severity, dedupe_key, details)
  values (
    left(target_issue_code, 120),
    target_severity,
    left(target_dedupe_key, 240),
    coalesce(target_details, '{}'::jsonb)
  )
  on conflict (dedupe_key) do nothing
  returning id into alert_id;

  if alert_id is null then
    select a.id into alert_id
    from private.system_health_alerts a
    where a.dedupe_key = left(target_dedupe_key, 240);
  end if;

  return alert_id;
end;
$$;

revoke all on function private.enqueue_system_health_alert(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.enqueue_system_health_alert(text, text, text, jsonb) to service_role;

create or replace function public.record_system_synthetic_probe(
  target_key text,
  target_url text,
  target_ok boolean,
  target_http_status integer default null,
  target_latency_ms integer default null,
  target_error_code text default null,
  target_checked_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
begin
  if nullif(trim(target_key), '') is null or char_length(target_key) > 80 then
    raise exception 'invalid_target_key';
  end if;
  if nullif(trim(target_url), '') is null or char_length(target_url) > 500 then
    raise exception 'invalid_target_url';
  end if;

  insert into private.system_synthetic_probe_results (
    target_key, target_url, ok, http_status, latency_ms, error_code, checked_at
  ) values (
    lower(trim(target_key)),
    trim(target_url),
    target_ok,
    target_http_status,
    target_latency_ms,
    nullif(left(coalesce(target_error_code, ''), 160), ''),
    coalesce(target_checked_at, now())
  )
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.record_system_synthetic_probe(text, text, boolean, integer, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_system_synthetic_probe(text, text, boolean, integer, integer, text, timestamptz) to service_role;

create or replace function private.run_system_health_check(target_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  started_at_value timestamptz := now();
  completed_at_value timestamptz;
  health_status text := 'healthy';
  warning_count_value integer := 0;
  critical_count_value integer := 0;
  error_count_15m integer := 0;
  critical_errors_15m integer := 0;
  http_5xx_15m integer := 0;
  auth_errors_15m integer := 0;
  resource_errors_15m integer := 0;
  top_fingerprint_count integer := 0;
  top_fingerprint_value text;
  csp_total_15m integer := 0;
  csp_actionable_15m integer := 0;
  probe_failed_count integer := 0;
  probe_stale_count integer := 0;
  cron_failed_count integer := 0;
  cron_stale_count integer := 0;
  issues_value jsonb := '[]'::jsonb;
  metrics_value jsonb;
  issue_record record;
  health_run_id uuid;
  bucket_key text := to_char(date_trunc('hour', now()) at time zone 'UTC', 'YYYYMMDDHH24');
begin
  select count(*) into error_count_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes';

  select count(*) into critical_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.severity = 'critical';

  select count(*) into http_5xx_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.http_status between 500 and 599;

  select count(*) into auth_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'auth';

  select count(*) into resource_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'resource';

  select grouped.fingerprint, grouped.events
    into top_fingerprint_value, top_fingerprint_count
  from (
    select e.fingerprint, count(*)::integer as events
    from public.app_error_events e
    where e.created_at >= now() - interval '15 minutes'
      and nullif(e.fingerprint, '') is not null
    group by e.fingerprint
    order by count(*) desc
    limit 1
  ) grouped;
  top_fingerprint_count := coalesce(top_fingerprint_count, 0);

  select count(*) into csp_total_15m
  from public.csp_violation_reports c
  where c.created_at >= now() - interval '15 minutes';

  select count(*) into csp_actionable_15m
  from public.csp_violation_reports c
  where c.created_at >= now() - interval '15 minutes'
    and coalesce(c.blocked_uri, '') not like 'https://static.cloudflareinsights.com/%';

  with expected(target_key) as (
    values ('home'), ('health'), ('login'), ('student_access')
  ), latest as (
    select distinct on (p.target_key)
      p.target_key, p.ok, p.checked_at
    from private.system_synthetic_probe_results p
    order by p.target_key, p.checked_at desc
  )
  select
    count(*) filter (where latest.target_key is not null and latest.checked_at >= now() - interval '12 minutes' and latest.ok = false)::integer,
    count(*) filter (where latest.target_key is null or latest.checked_at < now() - interval '12 minutes')::integer
  into probe_failed_count, probe_stale_count
  from expected
  left join latest using (target_key);

  with monitored(jobname, max_age_minutes) as (
    values
      ('mercado-pago-reconciliation', 15),
      ('payment-alert-health-scan', 15),
      ('payment-financial-health-check', 15),
      ('mercado-pago-chargeback-reconciliation', 90),
      ('sync-auto-makeup-slots-30-days', 1560),
      ('daily-data-retention-maintenance', 1560)
  ), job_state as (
    select m.jobname, m.max_age_minutes, j.jobid,
      latest.status as last_status,
      latest.end_time as last_end_time
    from monitored m
    left join cron.job j on j.jobname = m.jobname and j.active = true
    left join lateral (
      select d.status, d.end_time
      from cron.job_run_details d
      where d.jobid = j.jobid
      order by d.start_time desc
      limit 1
    ) latest on true
  )
  select
    count(*) filter (where last_status = 'failed')::integer,
    count(*) filter (
      where jobid is null
         or last_end_time is null
         or last_end_time < now() - make_interval(mins => max_age_minutes)
    )::integer
  into cron_failed_count, cron_stale_count
  from job_state;

  create temporary table if not exists pg_temp.system_health_issues (
    issue_code text,
    severity text,
    details jsonb
  ) on commit drop;
  truncate pg_temp.system_health_issues;

  if critical_errors_15m > 0 then
    insert into pg_temp.system_health_issues values (
      'critical_application_errors', 'critical',
      jsonb_build_object('count_15m', critical_errors_15m)
    );
  end if;

  if http_5xx_15m >= 5 then
    insert into pg_temp.system_health_issues values (
      'http_5xx_burst', 'critical', jsonb_build_object('count_15m', http_5xx_15m)
    );
  elsif http_5xx_15m >= 2 then
    insert into pg_temp.system_health_issues values (
      'http_5xx_elevated', 'warning', jsonb_build_object('count_15m', http_5xx_15m)
    );
  end if;

  if auth_errors_15m >= 5 then
    insert into pg_temp.system_health_issues values (
      'auth_error_burst', 'warning', jsonb_build_object('count_15m', auth_errors_15m)
    );
  end if;

  if top_fingerprint_count >= 25 then
    insert into pg_temp.system_health_issues values (
      'application_error_fingerprint_burst', 'critical',
      jsonb_build_object('count_15m', top_fingerprint_count, 'fingerprint', top_fingerprint_value)
    );
  elsif top_fingerprint_count >= 10 then
    insert into pg_temp.system_health_issues values (
      'application_error_fingerprint_burst', 'warning',
      jsonb_build_object('count_15m', top_fingerprint_count, 'fingerprint', top_fingerprint_value)
    );
  end if;

  if resource_errors_15m >= 15 then
    insert into pg_temp.system_health_issues values (
      'resource_error_burst', 'warning', jsonb_build_object('count_15m', resource_errors_15m)
    );
  end if;

  if csp_actionable_15m >= 10 then
    insert into pg_temp.system_health_issues values (
      'csp_violation_burst', 'warning',
      jsonb_build_object('count_15m', csp_actionable_15m, 'total_count_15m', csp_total_15m)
    );
  end if;

  if probe_failed_count >= 2 then
    insert into pg_temp.system_health_issues values (
      'synthetic_availability_failure', 'critical', jsonb_build_object('failed_targets', probe_failed_count)
    );
  elsif probe_failed_count = 1 then
    insert into pg_temp.system_health_issues values (
      'synthetic_availability_failure', 'warning', jsonb_build_object('failed_targets', probe_failed_count)
    );
  end if;

  if probe_stale_count > 0 then
    insert into pg_temp.system_health_issues values (
      'synthetic_probe_stale', 'warning', jsonb_build_object('stale_or_missing_targets', probe_stale_count)
    );
  end if;

  if cron_failed_count > 0 then
    insert into pg_temp.system_health_issues values (
      'scheduled_job_failure', 'critical', jsonb_build_object('failed_jobs', cron_failed_count)
    );
  end if;

  if cron_stale_count >= 2 then
    insert into pg_temp.system_health_issues values (
      'scheduled_jobs_stale', 'critical', jsonb_build_object('stale_jobs', cron_stale_count)
    );
  elsif cron_stale_count = 1 then
    insert into pg_temp.system_health_issues values (
      'scheduled_jobs_stale', 'warning', jsonb_build_object('stale_jobs', cron_stale_count)
    );
  end if;

  select
    count(*) filter (where severity = 'warning')::integer,
    count(*) filter (where severity = 'critical')::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'code', issue_code,
      'severity', severity,
      'details', details
    ) order by severity desc, issue_code), '[]'::jsonb)
  into warning_count_value, critical_count_value, issues_value
  from pg_temp.system_health_issues;

  if critical_count_value > 0 then
    health_status := 'critical';
  elsif warning_count_value > 0 then
    health_status := 'degraded';
  end if;

  completed_at_value := now();
  metrics_value := jsonb_build_object(
    'application_errors_15m', error_count_15m,
    'critical_errors_15m', critical_errors_15m,
    'http_5xx_15m', http_5xx_15m,
    'auth_errors_15m', auth_errors_15m,
    'resource_errors_15m', resource_errors_15m,
    'top_fingerprint_15m', top_fingerprint_value,
    'top_fingerprint_count_15m', top_fingerprint_count,
    'csp_total_15m', csp_total_15m,
    'csp_actionable_15m', csp_actionable_15m,
    'synthetic_failed_targets', probe_failed_count,
    'synthetic_stale_targets', probe_stale_count,
    'scheduled_failed_jobs', cron_failed_count,
    'scheduled_stale_jobs', cron_stale_count
  );

  insert into private.system_health_runs (
    status, issue_count, critical_count, warning_count, metrics, issues, started_at, completed_at
  ) values (
    health_status,
    warning_count_value + critical_count_value,
    critical_count_value,
    warning_count_value,
    metrics_value,
    issues_value,
    started_at_value,
    completed_at_value
  ) returning id into health_run_id;

  if target_notify then
    for issue_record in select * from pg_temp.system_health_issues loop
      perform private.enqueue_system_health_alert(
        issue_record.issue_code,
        issue_record.severity,
        issue_record.issue_code || ':' || bucket_key,
        issue_record.details || jsonb_build_object('health_run_id', health_run_id, 'health_status', health_status)
      );
    end loop;
  end if;

  delete from private.system_synthetic_probe_results where checked_at < now() - interval '30 days';
  delete from private.system_health_runs where completed_at < now() - interval '90 days';
  delete from private.system_health_alerts where created_at < now() - interval '180 days' and status = 'sent';

  return jsonb_build_object(
    'id', health_run_id,
    'status', health_status,
    'issue_count', warning_count_value + critical_count_value,
    'critical_count', critical_count_value,
    'warning_count', warning_count_value,
    'metrics', metrics_value,
    'issues', issues_value,
    'completed_at', completed_at_value
  );
end;
$$;

revoke all on function private.run_system_health_check(boolean) from public, anon, authenticated;
grant execute on function private.run_system_health_check(boolean) to service_role;

create or replace function public.run_system_health_check_internal(target_notify boolean default true)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.run_system_health_check(target_notify);
$$;

revoke all on function public.run_system_health_check_internal(boolean) from public, anon, authenticated;
grant execute on function public.run_system_health_check_internal(boolean) to service_role;

create or replace function public.begin_system_health_alert_delivery_internal(target_alert_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_record private.system_health_alerts%rowtype;
begin
  update private.system_health_alerts a
  set attempts = a.attempts + 1,
      last_attempt_at = now(),
      updated_at = now(),
      last_error = null
  where a.id = target_alert_id
    and a.status = 'pending'
  returning * into alert_record;

  if alert_record.id is null then
    select * into alert_record from private.system_health_alerts a where a.id = target_alert_id;
  end if;

  if alert_record.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', alert_record.id,
    'issue_code', alert_record.issue_code,
    'severity', alert_record.severity,
    'status', alert_record.status,
    'attempts', alert_record.attempts,
    'details', alert_record.details,
    'created_at', alert_record.created_at
  );
end;
$$;

revoke all on function public.begin_system_health_alert_delivery_internal(uuid) from public, anon, authenticated;
grant execute on function public.begin_system_health_alert_delivery_internal(uuid) to service_role;

create or replace function public.finish_system_health_alert_delivery_internal(
  target_alert_id uuid,
  target_status text,
  target_error text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_status not in ('sent', 'failed') then
    raise exception 'invalid_alert_status';
  end if;

  update private.system_health_alerts a
  set status = target_status,
      sent_at = case when target_status = 'sent' then now() else a.sent_at end,
      last_error = case when target_status = 'failed' then left(coalesce(target_error, 'delivery_failed'), 500) else null end,
      updated_at = now()
  where a.id = target_alert_id;

  return found;
end;
$$;

revoke all on function public.finish_system_health_alert_delivery_internal(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_system_health_alert_delivery_internal(uuid, text, text) to service_role;

create or replace function public.get_system_health_dashboard_internal()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_health jsonb;
  probes jsonb;
  crons jsonb;
  alerts jsonb;
begin
  select to_jsonb(r) into latest_health
  from (
    select id, status, issue_count, critical_count, warning_count, metrics, issues, completed_at
    from private.system_health_runs
    order by completed_at desc
    limit 1
  ) r;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.target_key), '[]'::jsonb) into probes
  from (
    select distinct on (target_key)
      target_key, target_url, ok, http_status, latency_ms, error_code, checked_at
    from private.system_synthetic_probe_results
    order by target_key, checked_at desc
  ) p;

  with monitored(jobname, max_age_minutes) as (
    values
      ('mercado-pago-reconciliation', 15),
      ('payment-alert-health-scan', 15),
      ('payment-financial-health-check', 15),
      ('mercado-pago-chargeback-reconciliation', 90),
      ('sync-auto-makeup-slots-30-days', 1560),
      ('daily-data-retention-maintenance', 1560),
      ('system-synthetic-probe', 15),
      ('system-health-watchdog', 20)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobname', m.jobname,
    'active', coalesce(j.active, false),
    'last_status', latest.status,
    'last_run_at', latest.start_time,
    'last_completed_at', latest.end_time,
    'stale', j.jobid is null or latest.end_time is null or latest.end_time < now() - make_interval(mins => m.max_age_minutes)
  ) order by m.jobname), '[]'::jsonb) into crons
  from monitored m
  left join cron.job j on j.jobname = m.jobname
  left join lateral (
    select d.status, d.start_time, d.end_time
    from cron.job_run_details d
    where d.jobid = j.jobid
    order by d.start_time desc
    limit 1
  ) latest on true;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into alerts
  from (
    select id, issue_code, severity, status, attempts, details, last_error, created_at, sent_at
    from private.system_health_alerts
    order by created_at desc
    limit 20
  ) a;

  return jsonb_build_object(
    'health', latest_health,
    'probes', probes,
    'crons', crons,
    'alerts', alerts,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.get_system_health_dashboard_internal() from public, anon, authenticated;
grant execute on function public.get_system_health_dashboard_internal() to service_role;

create or replace function private.dispatch_system_health_alert_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select ds.decrypted_secret into webhook_secret
  from vault.decrypted_secrets ds
  where ds.name = 'teacherflavius_notification_webhook_secret'
  limit 1;

  if nullif(webhook_secret, '') is null then
    raise warning 'System health alert webhook secret is unavailable';
    return new;
  end if;

  perform net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-system-health-alert',
    body := jsonb_build_object(
      'type', tg_op,
      'schema', tg_table_schema,
      'table', tg_table_name,
      'record', jsonb_build_object('id', new.id)
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke all on function private.dispatch_system_health_alert_webhook() from public, anon, authenticated;
grant execute on function private.dispatch_system_health_alert_webhook() to service_role;

drop trigger if exists system_health_alert_dispatch on private.system_health_alerts;
create trigger system_health_alert_dispatch
after insert or update of status on private.system_health_alerts
for each row
execute function private.dispatch_system_health_alert_webhook();

create or replace function private.dispatch_system_synthetic_probe()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  select ds.decrypted_secret into webhook_secret
  from vault.decrypted_secrets ds
  where ds.name = 'teacherflavius_notification_webhook_secret'
  limit 1;

  if nullif(webhook_secret, '') is null then
    raise warning 'System synthetic probe webhook secret is unavailable';
    return;
  end if;

  perform net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/system-synthetic-probe',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    timeout_milliseconds := 25000
  );
end;
$$;

revoke all on function private.dispatch_system_synthetic_probe() from public, anon, authenticated;
grant execute on function private.dispatch_system_synthetic_probe() to service_role;

create or replace function private.system_health_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_health_at timestamptz;
  retried_alerts integer := 0;
  stalled integer := 0;
  bucket_key text := to_char(date_trunc('hour', now()) at time zone 'UTC', 'YYYYMMDDHH24');
begin
  select max(r.completed_at) into last_health_at from private.system_health_runs r;

  if last_health_at is null or last_health_at < now() - interval '15 minutes' then
    perform private.enqueue_system_health_alert(
      'system_health_stalled',
      'critical',
      'system_health_stalled:' || bucket_key,
      jsonb_build_object(
        'last_health_at', last_health_at,
        'minutes_since_health', case when last_health_at is null then null else floor(extract(epoch from (now() - last_health_at)) / 60)::integer end
      )
    );
    stalled := 1;
  end if;

  update private.system_health_alerts a
  set status = 'pending', updated_at = now()
  where a.status = 'failed'
    and a.attempts < 5
    and coalesce(a.last_attempt_at, a.created_at) < now() - interval '10 minutes';
  get diagnostics retried_alerts = row_count;

  return jsonb_build_object(
    'stalled', stalled,
    'retried_alerts', retried_alerts,
    'last_health_at', last_health_at
  );
end;
$$;

revoke all on function private.system_health_watchdog() from public, anon, authenticated;
grant execute on function private.system_health_watchdog() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname in ('system-synthetic-probe', 'system-health-watchdog');

select cron.schedule(
  'system-synthetic-probe',
  '1-59/5 * * * *',
  $$select private.dispatch_system_synthetic_probe();$$
);

select cron.schedule(
  'system-health-watchdog',
  '4,14,24,34,44,54 * * * *',
  $$select private.system_health_watchdog();$$
);
