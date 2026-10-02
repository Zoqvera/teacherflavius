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
  profile_email_mismatch_unlinked integer := 0;
  google_links_missing_auth integer := 0;
  google_links_missing_profile integer := 0;
  google_link_cleanup_pending integer := 0;
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
    'profile_email_mismatch_unlinked', profile_email_mismatch_unlinked,
    'google_links_missing_auth', google_links_missing_auth,
    'google_links_missing_profile', google_links_missing_profile,
    'google_link_cleanup_pending', google_link_cleanup_pending,
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


select private.run_auth_account_health_check(false);
