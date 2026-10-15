-- Stage 7.2: attach transactional-email diagnosis to the existing health loop.
-- No new cron, outbound transport, student mutation, or separate alert pipeline.
-- The legacy health-check core is left intact; the new checks are isolated.

create or replace function private.inspect_transactional_email_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $monitor$
declare
  queue_record record;
  retry_record record;
  queue_metrics jsonb := '{}'::jsonb;
  alerts jsonb := '[]'::jsonb;
  job_metrics jsonb;
begin
  for queue_record in
    with queues(queue_name) as (
      values ('matricula'), ('reposicao'), ('cancelamento_regular')
    ),
    notifications as (
      select 'matricula' as queue_name, status, attempts, created_at, sent_at
      from public.enrollment_email_notifications
      union all
      select 'reposicao', status, attempts, created_at, sent_at
      from public.makeup_class_email_notifications
      union all
      select 'cancelamento_regular', status, attempts, created_at, sent_at
      from public.regular_lesson_cancellation_email_notifications
    )
    select q.queue_name,
           count(n.status)::integer as total,
           count(*) filter (where n.status = 'sent')::integer as sent,
           count(*) filter (where n.status = 'pending')::integer as pending,
           count(*) filter (where n.status = 'failed')::integer as failed,
           count(*) filter (
             where n.status in ('pending', 'failed')
               and n.created_at < now() - interval '20 minutes'
           )::integer as delayed,
           count(*) filter (
             where n.status in ('pending', 'failed')
               and n.created_at < now() - interval '18 hours'
           )::integer as expired,
           count(*) filter (
             where n.status in ('pending', 'failed')
               and n.attempts >= 3
           )::integer as exhausted,
           count(*) filter (
             where n.status = 'sent' and n.sent_at is null
           )::integer as missing_sent_at
    from queues q
    left join notifications n using (queue_name)
    group by q.queue_name
    order by q.queue_name
  loop
    queue_metrics := queue_metrics || jsonb_build_object(
      queue_record.queue_name,
      jsonb_build_object(
        'total', queue_record.total,
        'sent', queue_record.sent,
        'pending', queue_record.pending,
        'failed', queue_record.failed,
        'delayed', queue_record.delayed,
        'expired', queue_record.expired,
        'exhausted', queue_record.exhausted,
        'missing_sent_at', queue_record.missing_sent_at
      )
    );

    if queue_record.delayed > 0 then
      alerts := alerts || jsonb_build_array(jsonb_build_object(
        'code', 'email_queue_delayed',
        'severity', case when queue_record.expired > 0 then 'critical' else 'warning' end,
        'details', jsonb_build_object(
          'queue', queue_record.queue_name,
          'delayed', queue_record.delayed,
          'expired', queue_record.expired
        )
      ));
    end if;

    if queue_record.exhausted > 0 then
      alerts := alerts || jsonb_build_array(jsonb_build_object(
        'code', 'email_queue_retry_exhausted',
        'severity', 'critical',
        'details', jsonb_build_object(
          'queue', queue_record.queue_name,
          'count', queue_record.exhausted
        )
      ));
    end if;

    if queue_record.missing_sent_at > 0 then
      alerts := alerts || jsonb_build_array(jsonb_build_object(
        'code', 'email_sent_timestamp_missing',
        'severity', 'warning',
        'details', jsonb_build_object(
          'queue', queue_record.queue_name,
          'count', queue_record.missing_sent_at
        )
      ));
    end if;
  end loop;

  select j.jobid, j.active, j.schedule,
         (select max(d.end_time)
          from cron.job_run_details d
          where d.jobid = j.jobid and d.status = 'succeeded') as last_success,
         (select d.status
          from cron.job_run_details d
          where d.jobid = j.jobid
          order by d.start_time desc
          limit 1) as last_status
    into retry_record
  from (values (1)) as target(dummy)
  left join cron.job j on j.jobname = 'transactional-email-retry-10m';

  job_metrics := jsonb_build_object(
    'active', coalesce(retry_record.active, false),
    'schedule_valid', coalesce(retry_record.schedule = '*/10 * * * *', false),
    'last_success_at', retry_record.last_success,
    'last_status', retry_record.last_status
  );

  if retry_record.jobid is null
     or coalesce(retry_record.active, false) = false
     or coalesce(retry_record.schedule, '') <> '*/10 * * * *'
     or retry_record.last_success is null
     or retry_record.last_success < now() - interval '20 minutes'
  then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'code', 'email_retry_cron_unhealthy',
      'severity', 'critical',
      'details', job_metrics
    ));
  elsif retry_record.last_status is distinct from 'succeeded' then
    alerts := alerts || jsonb_build_array(jsonb_build_object(
      'code', 'email_retry_cron_execution_failed',
      'severity', 'warning',
      'details', job_metrics
    ));
  end if;

  return jsonb_build_object(
    'metrics', jsonb_build_object('queues', queue_metrics, 'cron', job_metrics),
    'issues', alerts
  );
end;
$monitor$;

revoke all on function private.inspect_transactional_email_health()
  from public, anon, authenticated;
grant execute on function private.inspect_transactional_email_health()
  to service_role;

-- BEFORE INSERT preserves the canonical health run as the single source of truth.
create or replace function private.attach_email_health_to_system_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $attach$
declare
  snapshot jsonb;
  email_issues jsonb;
  new_warnings integer;
  new_criticals integer;
begin
  snapshot := private.inspect_transactional_email_health();
  email_issues := snapshot->'issues';

  select count(*) filter (where issue->>'severity' = 'warning')::integer,
         count(*) filter (where issue->>'severity' = 'critical')::integer
    into new_warnings, new_criticals
  from jsonb_array_elements(email_issues) as issues(issue);

  new.metrics := new.metrics || jsonb_build_object(
    'email_notifications', snapshot->'metrics'
  );
  new.issues := new.issues || email_issues;
  new.warning_count := new.warning_count + new_warnings;
  new.critical_count := new.critical_count + new_criticals;
  new.issue_count := new.warning_count + new.critical_count;

  new.status := case
    when new.critical_count > 0 then 'critical'
    when new.warning_count > 0 then 'degraded'
    else 'healthy'
  end;
  return new;
end;
$attach$;

revoke all on function private.attach_email_health_to_system_run()
  from public, anon, authenticated;

drop trigger if exists attach_email_health_to_system_run
  on private.system_health_runs;
create trigger attach_email_health_to_system_run
before insert on private.system_health_runs
for each row execute function private.attach_email_health_to_system_run();

-- Reuse the existing deduplicated delivery queue; respect target_notify=false.
create or replace function private.enqueue_email_health_alerts_from_system_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enqueue$
declare
  issue jsonb;
  issue_code text;
  issue_queue text;
  bucket text := to_char(date_trunc('hour', now()) at time zone 'UTC', 'YYYYMMDDHH24');
begin
  if coalesce(current_setting('app.email_health_notify', true), 'false') <> 'true' then
    return new;
  end if;

  for issue in
    select value from jsonb_array_elements(new.issues) as issue_values(value)
  loop
    issue_code := issue->>'code';
    if left(issue_code, 6) <> 'email_' then
      continue;
    end if;

    issue_queue := coalesce(issue->'details'->>'queue', 'cron');
    perform private.enqueue_system_health_alert(
      issue_code,
      issue->>'severity',
      issue_code || ':' || issue_queue || ':' || bucket,
      (issue->'details') || jsonb_build_object(
        'health_run_id', new.id,
        'health_status', new.status
      )
    );
  end loop;
  return new;
end;
$enqueue$;

revoke all on function private.enqueue_email_health_alerts_from_system_run()
  from public, anon, authenticated;

drop trigger if exists enqueue_email_health_alerts_from_system_run
  on private.system_health_runs;
create trigger enqueue_email_health_alerts_from_system_run
after insert on private.system_health_runs
for each row execute function private.enqueue_email_health_alerts_from_system_run();

-- The existing entrypoint propagates its notification flag without changing
-- private.run_system_health_check(), its independent jobs or its API contract.
create or replace function public.run_system_health_check_internal(
  target_notify boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $entrypoint$
declare
  original_flag text := current_setting('app.email_health_notify', true);
  health_result jsonb;
  persisted_run record;
begin
  perform set_config('app.email_health_notify',
                     case when target_notify then 'true' else 'false' end,
                     true);
  health_result := private.run_system_health_check(target_notify);
  perform set_config('app.email_health_notify', coalesce(original_flag, 'false'), true);

  select r.status, r.issue_count, r.warning_count, r.critical_count,
         r.issues, r.metrics
    into strict persisted_run
  from private.system_health_runs r
  where r.id = (health_result->>'id')::uuid;

  return health_result || jsonb_build_object(
    'status', persisted_run.status,
    'issue_count', persisted_run.issue_count,
    'warning_count', persisted_run.warning_count,
    'critical_count', persisted_run.critical_count,
    'issues', persisted_run.issues,
    'metrics', persisted_run.metrics
  );
end;
$entrypoint$;

revoke all on function public.run_system_health_check_internal(boolean)
  from public, anon, authenticated;
grant execute on function public.run_system_health_check_internal(boolean)
  to service_role;
