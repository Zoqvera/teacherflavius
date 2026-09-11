create table if not exists private.auth_account_health_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('healthy','degraded','critical')),
  issue_count integer not null default 0 check (issue_count >= 0),
  critical_count integer not null default 0 check (critical_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  metrics jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now()
);

create index if not exists auth_account_health_runs_completed_at_idx
  on private.auth_account_health_runs (completed_at desc);

revoke all on table private.auth_account_health_runs from public, anon, authenticated;
grant select, insert, update, delete on table private.auth_account_health_runs to service_role;

create or replace function private.run_auth_account_health_check(target_notify boolean default true)
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
  issue_count_value integer := 0;
  run_id uuid;
  issue_record record;
  auth_users_without_profile_older_1h integer := 0;
  active_profiles_without_auth_user integer := 0;
  active_students_unconfirmed_auth integer := 0;
  active_students_without_identity integer := 0;
  mapped_admin_missing_auth integer := 0;
  mapped_admin_without_verified_mfa integer := 0;
  profile_email_mismatch_unlinked integer := 0;
  google_links_missing_auth integer := 0;
  google_links_missing_profile integer := 0;
  google_link_cleanup_pending integer := 0;
  stale_unverified_mfa_factors integer := 0;
  email_only_admin_rows integer := 0;
  unrevoked_refresh_tokens integer := 0;
  users_with_multiple_unrevoked_sessions integer := 0;
  metrics_value jsonb;
  issues_value jsonb;
begin
  create temporary table if not exists pg_temp.auth_account_health_issues (
    issue_code text,
    severity text,
    details jsonb
  ) on commit drop;
  truncate pg_temp.auth_account_health_issues;

  select count(*)::integer into auth_users_without_profile_older_1h
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.deleted_at is null
    and u.created_at < now() - interval '1 hour'
    and p.id is null;

  select count(*)::integer into active_profiles_without_auth_user
  from public.profiles p
  left join auth.users u on u.id = p.id and u.deleted_at is null
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and u.id is null;

  select count(*)::integer into active_students_unconfirmed_auth
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and u.confirmed_at is null;

  select count(*)::integer into active_students_without_identity
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and not exists (select 1 from auth.identities i where i.user_id = u.id);

  select count(*)::integer into mapped_admin_missing_auth
  from public.teacher_admins ta
  where ta.user_id is not null
    and not exists (
      select 1 from auth.users u
      where u.id = ta.user_id and u.deleted_at is null
    );

  select count(*)::integer into mapped_admin_without_verified_mfa
  from public.teacher_admins ta
  where ta.user_id is not null
    and not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = ta.user_id and f.status = 'verified'
    );

  select count(*)::integer into profile_email_mismatch_unlinked
  from auth.users u
  join public.profiles p on p.id = u.id
  left join public.student_google_account_links l on l.google_user_id = u.id
  where u.deleted_at is null
    and lower(coalesce(u.email, '')) <> lower(coalesce(p.email, ''))
    and l.google_user_id is null;

  select count(*)::integer into google_links_missing_auth
  from public.student_google_account_links l
  where not exists (
    select 1 from auth.users u
    where u.id = l.google_user_id and u.deleted_at is null
  );

  select count(*)::integer into google_links_missing_profile
  from public.student_google_account_links l
  where not exists (
    select 1 from public.profiles p where p.id = l.google_user_id
  );

  select count(*)::integer into google_link_cleanup_pending
  from public.student_google_account_links l
  where l.link_mode = 'alias' and l.legacy_auth_deleted = false;

  select count(*)::integer into stale_unverified_mfa_factors
  from auth.mfa_factors f
  where f.status <> 'verified'
    and f.created_at < now() - interval '24 hours';

  select count(*)::integer into email_only_admin_rows
  from public.teacher_admins ta where ta.user_id is null;

  select count(*)::integer into unrevoked_refresh_tokens
  from auth.refresh_tokens r where r.revoked = false;

  select count(*)::integer into users_with_multiple_unrevoked_sessions
  from (
    select r.user_id
    from auth.refresh_tokens r
    where r.revoked = false
    group by r.user_id
    having count(distinct r.session_id) > 1
  ) q;

  if auth_users_without_profile_older_1h > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_user_without_profile','warning',jsonb_build_object('count',auth_users_without_profile_older_1h));
  end if;
  if active_profiles_without_auth_user > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_active_profile_without_user','critical',jsonb_build_object('count',active_profiles_without_auth_user));
  end if;
  if active_students_unconfirmed_auth > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_active_student_unconfirmed','critical',jsonb_build_object('count',active_students_unconfirmed_auth));
  end if;
  if active_students_without_identity > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_active_student_without_identity','critical',jsonb_build_object('count',active_students_without_identity));
  end if;
  if mapped_admin_missing_auth > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_admin_missing_user','critical',jsonb_build_object('count',mapped_admin_missing_auth));
  end if;
  if mapped_admin_without_verified_mfa > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_admin_without_verified_mfa','critical',jsonb_build_object('count',mapped_admin_without_verified_mfa));
  end if;
  if profile_email_mismatch_unlinked > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_profile_email_mismatch','warning',jsonb_build_object('count',profile_email_mismatch_unlinked));
  end if;
  if google_links_missing_auth > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_google_link_missing_user','critical',jsonb_build_object('count',google_links_missing_auth));
  end if;
  if google_links_missing_profile > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_google_link_missing_profile','critical',jsonb_build_object('count',google_links_missing_profile));
  end if;
  if google_link_cleanup_pending > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_google_link_cleanup_pending','warning',jsonb_build_object('count',google_link_cleanup_pending));
  end if;
  if stale_unverified_mfa_factors > 0 then
    insert into pg_temp.auth_account_health_issues values ('auth_stale_unverified_mfa_factor','warning',jsonb_build_object('count',stale_unverified_mfa_factors));
  end if;

  select
    count(*) filter (where severity = 'warning')::integer,
    count(*) filter (where severity = 'critical')::integer,
    coalesce(jsonb_agg(jsonb_build_object('code',issue_code,'severity',severity,'details',details) order by issue_code),'[]'::jsonb)
  into warning_count_value, critical_count_value, issues_value
  from pg_temp.auth_account_health_issues;

  warning_count_value := coalesce(warning_count_value, 0);
  critical_count_value := coalesce(critical_count_value, 0);
  issue_count_value := warning_count_value + critical_count_value;
  if critical_count_value > 0 then
    health_status := 'critical';
  elsif warning_count_value > 0 then
    health_status := 'degraded';
  end if;

  metrics_value := jsonb_build_object(
    'auth_users_without_profile_older_1h', auth_users_without_profile_older_1h,
    'active_profiles_without_auth_user', active_profiles_without_auth_user,
    'active_students_unconfirmed_auth', active_students_unconfirmed_auth,
    'active_students_without_identity', active_students_without_identity,
    'mapped_admin_missing_auth', mapped_admin_missing_auth,
    'mapped_admin_without_verified_mfa', mapped_admin_without_verified_mfa,
    'profile_email_mismatch_unlinked', profile_email_mismatch_unlinked,
    'google_links_missing_auth', google_links_missing_auth,
    'google_links_missing_profile', google_links_missing_profile,
    'google_link_cleanup_pending', google_link_cleanup_pending,
    'stale_unverified_mfa_factors', stale_unverified_mfa_factors,
    'email_only_admin_rows_info', email_only_admin_rows,
    'unrevoked_refresh_tokens_info', unrevoked_refresh_tokens,
    'users_with_multiple_unrevoked_sessions_info', users_with_multiple_unrevoked_sessions
  );

  completed_at_value := now();
  insert into private.auth_account_health_runs(status,issue_count,critical_count,warning_count,metrics,issues,started_at,completed_at)
  values (health_status,issue_count_value,critical_count_value,warning_count_value,metrics_value,issues_value,started_at_value,completed_at_value)
  returning id into run_id;

  if target_notify then
    for issue_record in select issue_code,severity,details from pg_temp.auth_account_health_issues loop
      perform private.enqueue_system_health_alert(
        issue_record.issue_code,
        issue_record.severity,
        'auth-health:' || issue_record.issue_code || ':' || pg_catalog.md5(issue_record.details::text),
        issue_record.details || jsonb_build_object('auth_health_run_id',run_id,'auth_health_status',health_status)
      );
    end loop;
  end if;

  delete from private.auth_account_health_runs where completed_at < now() - interval '90 days';

  return jsonb_build_object(
    'id',run_id,'status',health_status,'issue_count',issue_count_value,
    'critical_count',critical_count_value,'warning_count',warning_count_value,
    'metrics',metrics_value,'issues',issues_value,'completed_at',completed_at_value
  );
end;
$$;

revoke all on function private.run_auth_account_health_check(boolean) from public, anon, authenticated;
grant execute on function private.run_auth_account_health_check(boolean) to service_role;

create or replace function private.system_health_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_health_at timestamptz;
  last_data_quality_at timestamptz;
  last_auth_health_at timestamptz;
  activated_at_value timestamptz;
  retried_alerts integer := 0;
  stalled integer := 0;
  data_quality_stalled integer := 0;
  auth_health_stalled integer := 0;
  bootstrap_grace boolean := false;
  bucket_key text := to_char(date_trunc('hour', now()) at time zone 'UTC', 'YYYYMMDDHH24');
begin
  select max(r.completed_at) into last_health_at from private.system_health_runs r;
  select max(r.completed_at) into last_data_quality_at from private.operational_data_quality_runs r;
  select max(r.completed_at) into last_auth_health_at from private.auth_account_health_runs r;
  select c.activated_at into activated_at_value from private.system_health_monitor_config c where c.singleton = true;

  bootstrap_grace := last_health_at is null and activated_at_value is not null and activated_at_value > now() - interval '15 minutes';

  if not bootstrap_grace and (last_health_at is null or last_health_at < now() - interval '15 minutes') then
    perform private.enqueue_system_health_alert('system_health_stalled','critical','system_health_stalled:'||bucket_key,jsonb_build_object('last_health_at',last_health_at,'minutes_since_health',case when last_health_at is null then null else floor(extract(epoch from (now()-last_health_at))/60)::integer end));
    stalled := 1;
  end if;

  if last_data_quality_at is null or last_data_quality_at < now() - interval '90 minutes' then
    perform private.enqueue_system_health_alert('data_quality_check_stalled','warning','data_quality_check_stalled:'||bucket_key,jsonb_build_object('last_data_quality_at',last_data_quality_at,'minutes_since_data_quality',case when last_data_quality_at is null then null else floor(extract(epoch from (now()-last_data_quality_at))/60)::integer end));
    data_quality_stalled := 1;
  end if;

  if last_auth_health_at is null or last_auth_health_at < now() - interval '90 minutes' then
    perform private.enqueue_system_health_alert('auth_health_check_stalled','warning','auth_health_check_stalled:'||bucket_key,jsonb_build_object('last_auth_health_at',last_auth_health_at,'minutes_since_auth_health',case when last_auth_health_at is null then null else floor(extract(epoch from (now()-last_auth_health_at))/60)::integer end));
    auth_health_stalled := 1;
  end if;

  update private.system_health_alerts a set status='pending',updated_at=now()
  where a.status='failed' and a.attempts<5 and coalesce(a.last_attempt_at,a.created_at)<now()-interval '10 minutes';
  get diagnostics retried_alerts = row_count;

  return jsonb_build_object(
    'stalled',stalled,
    'data_quality_stalled',data_quality_stalled,
    'auth_health_stalled',auth_health_stalled,
    'bootstrap_grace',bootstrap_grace,
    'retried_alerts',retried_alerts,
    'last_health_at',last_health_at,
    'last_data_quality_at',last_data_quality_at,
    'last_auth_health_at',last_auth_health_at
  );
end;
$$;

revoke all on function private.system_health_watchdog() from public, anon, authenticated;
grant execute on function private.system_health_watchdog() to service_role;

create or replace function public.get_system_health_dashboard_internal()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_health jsonb;
  latest_data_quality jsonb;
  latest_auth_health jsonb;
  probes jsonb;
  crons jsonb;
  alerts jsonb;
begin
  select to_jsonb(r) into latest_health
  from (select id,status,issue_count,critical_count,warning_count,metrics,issues,completed_at from private.system_health_runs order by completed_at desc limit 1) r;

  select to_jsonb(r) into latest_data_quality
  from (select id,status,issue_count,critical_count,warning_count,metrics,issues,completed_at from private.operational_data_quality_runs order by completed_at desc limit 1) r;

  select to_jsonb(r) into latest_auth_health
  from (select id,status,issue_count,critical_count,warning_count,metrics,issues,completed_at from private.auth_account_health_runs order by completed_at desc limit 1) r;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.target_key),'[]'::jsonb) into probes
  from (select distinct on(target_key) target_key,target_url,ok,http_status,latency_ms,error_code,checked_at from private.system_synthetic_probe_results order by target_key,checked_at desc) p;

  with monitored(jobname,max_age_minutes) as (values
    ('mercado-pago-reconciliation',15),
    ('payment-alert-health-scan',15),
    ('payment-financial-health-check',15),
    ('mercado-pago-chargeback-reconciliation',90),
    ('sync-auto-makeup-slots-30-days',1560),
    ('daily-data-retention-maintenance',1560),
    ('system-synthetic-probe',15),
    ('system-health-watchdog',20),
    ('operational-data-quality-health-check',90),
    ('auth-account-health-check',90)
  )
  select coalesce(jsonb_agg(jsonb_build_object('jobname',m.jobname,'active',coalesce(j.active,false),'last_status',latest.status,'last_run_at',latest.start_time,'last_completed_at',latest.end_time,'stale',j.jobid is null or latest.end_time is null or latest.end_time < now()-make_interval(mins=>m.max_age_minutes)) order by m.jobname),'[]'::jsonb) into crons
  from monitored m
  left join cron.job j on j.jobname=m.jobname
  left join lateral (select d.status,d.start_time,d.end_time from cron.job_run_details d where d.jobid=j.jobid order by d.start_time desc limit 1) latest on true;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) into alerts
  from (select id,issue_code,severity,status,attempts,details,last_error,created_at,sent_at from private.system_health_alerts order by created_at desc limit 20) a;

  return jsonb_build_object(
    'health',latest_health,
    'data_quality',latest_data_quality,
    'auth_health',latest_auth_health,
    'probes',probes,
    'crons',crons,
    'alerts',alerts,
    'generated_at',now()
  );
end;
$$;

revoke all on function public.get_system_health_dashboard_internal() from public, anon, authenticated;
grant execute on function public.get_system_health_dashboard_internal() to service_role;

do $$
declare existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname='auth-account-health-check' limit 1;
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  perform cron.schedule('auth-account-health-check','22,52 * * * *','select private.run_auth_account_health_check(true);');
end;
$$;

select private.run_auth_account_health_check(false);
