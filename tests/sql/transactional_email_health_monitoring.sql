-- Run only in disposable CI Postgres, surrounded by BEGIN/ROLLBACK.
-- The existing system-health alert delivery trigger must be disabled in the
-- surrounding CI transaction so no HTTP call leaves the test environment.
do $audit$
declare
  first_run private.system_health_runs%rowtype;
  second_run private.system_health_runs%rowtype;
  third_run private.system_health_runs%rowtype;
  resulting_snapshot jsonb;
begin
  if has_function_privilege(
    'anon', 'private.inspect_transactional_email_health()', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'private.inspect_transactional_email_health()', 'EXECUTE'
  ) then
    raise exception 'The email health collector must not be browser-callable';
  end if;

  if exists (
    select 1 from cron.job
    where jobname = 'transactional-email-retry-10m'
  ) then
    raise exception 'CI fixture unexpectedly installed a retry job';
  end if;

  resulting_snapshot := private.inspect_transactional_email_health();
  if jsonb_array_length(resulting_snapshot->'issues') <> 1
     or resulting_snapshot->'issues'->0->>'code' <> 'email_retry_cron_unhealthy'
     or resulting_snapshot->'metrics'->'queues'->'cancelamento_regular'->>'total' <> '0'
  then
    raise exception 'Missing cron or empty queues not correctly inspected: %',
      resulting_snapshot;
  end if;

  perform set_config('app.email_health_notify', 'false', true);
  insert into private.system_health_runs(status, metrics, issues)
  values ('healthy', '{}'::jsonb, '[]'::jsonb)
  returning * into first_run;

  if first_run.status <> 'critical'
     or first_run.critical_count <> 1
     or first_run.issue_count <> 1
     or first_run.metrics->'email_notifications'->'cron'->>'active' <> 'false'
  then
    raise exception 'Health row did not inherit the email retry incident';
  end if;

  if exists (
    select 1 from private.system_health_alerts
    where issue_code = 'email_retry_cron_unhealthy'
  ) then
    raise exception 'Monitoring target_notify=false generated an alert';
  end if;

  perform set_config('app.email_health_notify', 'true', true);
  insert into private.system_health_runs(status, metrics, issues)
  values ('healthy', '{}'::jsonb, '[]'::jsonb)
  returning * into second_run;

  insert into private.system_health_runs(status, metrics, issues)
  values ('healthy', '{}'::jsonb, '[]'::jsonb)
  returning * into third_run;

  if second_run.status <> 'critical' or third_run.status <> 'critical' then
    raise exception 'A missing retry job did not affect canonical health';
  end if;

  if (
    select count(*) from private.system_health_alerts
    where issue_code = 'email_retry_cron_unhealthy'
  ) <> 1 then
    raise exception 'Repeated health runs must deduplicate one hourly alert';
  end if;

  if exists (
    select 1
    from private.system_health_alerts a
    where a.issue_code = 'email_retry_cron_unhealthy'
      and (a.details ? 'student_name' or a.details ? 'student_email')
  ) then
    raise exception 'An alert exposed personal data';
  end if;
end;
$audit$;

-- Verify the public wrapper preserves the persisted state and the
-- notification suppression contract without sending real webhooks.
select public.run_system_health_check_internal(false);
do $no_alert$
begin
  if (select status
      from private.system_health_runs
      order by completed_at desc, id desc limit 1) not in ('critical', 'degraded')
  then
    raise exception 'Public health wrapper did not integrate email diagnosis';
  end if;
  if (select count(*) from private.system_health_alerts
      where issue_code = 'email_retry_cron_unhealthy') <> 1
  then
    raise exception 'target_notify=false from the public wrapper sent an alert';
  end if;
end;
$no_alert$;
