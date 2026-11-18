-- Confirm same-origin synthetic availability failures across two probe cycles.
-- First-cycle transport failures remain visible as warnings; persistent outages
-- escalate to critical with a separate deduplication key.
CREATE OR REPLACE FUNCTION private.run_system_health_check(target_notify boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  optional_openai_pixel_errors_15m integer := 0;
  resource_top_fingerprint_count integer := 0;
  top_fingerprint_count integer := 0;
  top_fingerprint_value text;
  csp_total_15m integer := 0;
  csp_actionable_15m integer := 0;
  csp_actionable_raw_15m integer := 0;
  csp_top_group_count_15m integer := 0;
  csp_top_group_origin text;
  probe_failed_count integer := 0;
  probe_previous_failed_count integer := 0;
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

  select count(*) into optional_openai_pixel_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'resource'
    and e.source = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';

  select count(*) into resource_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'resource'
    and coalesce(e.source, '') not like 'https://static.cloudflareinsights.com/beacon.min.js/%'
    and coalesce(e.source, '') <> 'https://bzrcdn.openai.com/sdk/oaiq.min.js';

  select coalesce(max(grouped.events), 0)::integer
  into resource_top_fingerprint_count
  from (
    select e.fingerprint, count(*)::integer as events
    from public.app_error_events e
    where e.created_at >= now() - interval '15 minutes'
      and e.event_type = 'resource'
      and coalesce(e.source, '') not like 'https://static.cloudflareinsights.com/beacon.min.js/%'
      and coalesce(e.source, '') <> 'https://bzrcdn.openai.com/sdk/oaiq.min.js'
      and nullif(e.fingerprint, '') is not null
    group by e.fingerprint
  ) grouped;

  select grouped.fingerprint, grouped.events
    into top_fingerprint_value, top_fingerprint_count
  from (
    select e.fingerprint, count(*)::integer as events
    from public.app_error_events e
    where e.created_at >= now() - interval '15 minutes'
      and nullif(e.fingerprint, '') is not null
      and coalesce(e.source, '') <> 'https://bzrcdn.openai.com/sdk/oaiq.min.js'
    group by e.fingerprint
    order by count(*) desc
    limit 1
  ) grouped;
  top_fingerprint_count := coalesce(top_fingerprint_count, 0);

  select count(*) into csp_total_15m
  from public.csp_violation_reports c
  where c.created_at >= now() - interval '15 minutes';

  with actionable_csp as (
    select
      coalesce(c.document_uri, '') as document_uri,
      coalesce(c.effective_directive, c.violated_directive, '') as directive,
      case
        when coalesce(c.blocked_uri, '') ~ '^https?://'
          then lower(split_part(c.blocked_uri, '/', 3))
        else lower(coalesce(c.blocked_uri, ''))
      end as blocked_origin
    from public.csp_violation_reports c
    where c.created_at >= now() - interval '15 minutes'
      and coalesce(c.blocked_uri, '') not like 'https://static.cloudflareinsights.com/%'
      and coalesce(c.blocked_uri, '') not like 'https://bzrcdn.openai.com/%'
      and coalesce(c.blocked_uri, '') not like 'https://bzr.openai.com/%'
      and coalesce(c.blocked_uri, '') not like 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/%'
  ), csp_groups as (
    select
      document_uri,
      directive,
      blocked_origin,
      count(*)::integer as events
    from actionable_csp
    group by document_uri, directive, blocked_origin
  )
  select
    (select count(*)::integer from actionable_csp),
    count(*)::integer,
    coalesce(max(events), 0)::integer,
    (array_agg(blocked_origin order by events desc, blocked_origin))[1]
  into
    csp_actionable_raw_15m,
    csp_actionable_15m,
    csp_top_group_count_15m,
    csp_top_group_origin
  from csp_groups;

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

  -- Each path shares the same origin. A critical outage requires two
  -- independent five-minute probe cycles, not two failed paths in one cycle.
  with last_cycle as (
    select max(checked_at) as checked_at
    from private.system_synthetic_probe_results
  ), previous_cycle as (
    select distinct on (p.target_key)
      p.target_key, p.ok
    from private.system_synthetic_probe_results p
    cross join last_cycle last
    where p.checked_at < date_bin(
        '5 minutes', last.checked_at, timestamptz '2000-01-01 00:01:00+00'
      )
      and p.checked_at >= last.checked_at - interval '12 minutes'
    order by p.target_key, p.checked_at desc
  )
  select count(*)::integer into probe_previous_failed_count
  from previous_cycle where ok = false;

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

  if resource_errors_15m >= 15 and resource_top_fingerprint_count >= 5 then
    insert into pg_temp.system_health_issues values (
      'resource_error_burst',
      'warning',
      jsonb_build_object(
        'count_15m', resource_errors_15m,
        'top_resource_fingerprint_count_15m', resource_top_fingerprint_count
      )
    );
  end if;

  if csp_actionable_15m >= 10 then
    insert into pg_temp.system_health_issues values (
      'csp_violation_burst', 'warning',
      jsonb_build_object(
        'count_15m', csp_actionable_15m,
        'logical_group_count_15m', csp_actionable_15m,
        'raw_event_count_15m', csp_actionable_raw_15m,
        'total_count_15m', csp_total_15m,
        'top_group_event_count_15m', csp_top_group_count_15m,
        'top_group_origin', csp_top_group_origin
      )
    );
  end if;

  if probe_failed_count >= 2 and probe_previous_failed_count >= 2 then
    insert into pg_temp.system_health_issues values (
      'synthetic_availability_failure', 'critical', jsonb_build_object('failed_targets', probe_failed_count)
    );
  elsif probe_failed_count > 0 then
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
    'optional_openai_pixel_errors_15m', optional_openai_pixel_errors_15m,
    'resource_top_fingerprint_count_15m', resource_top_fingerprint_count,
    'top_fingerprint_15m', top_fingerprint_value,
    'top_fingerprint_count_15m', top_fingerprint_count,
    'csp_total_15m', csp_total_15m,
    'csp_actionable_15m', csp_actionable_15m,
    'csp_actionable_raw_15m', csp_actionable_raw_15m,
    'csp_top_group_count_15m', csp_top_group_count_15m,
    'csp_top_group_origin', csp_top_group_origin,
    'synthetic_failed_targets', probe_failed_count,
    'synthetic_previous_failed_targets', probe_previous_failed_count,
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
        issue_record.issue_code || ':' || bucket_key ||
          case when issue_record.issue_code = 'synthetic_availability_failure'
            then ':' || issue_record.severity else '' end,
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
$function$

