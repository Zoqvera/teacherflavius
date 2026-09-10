create table if not exists private.operational_data_quality_runs (
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

create index if not exists operational_data_quality_runs_completed_at_idx
  on private.operational_data_quality_runs (completed_at desc);

revoke all on table private.operational_data_quality_runs from public, anon, authenticated;
grant select, insert, update, delete on table private.operational_data_quality_runs to service_role;

create or replace function private.run_operational_data_quality_check(target_notify boolean default true)
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
  orphan_class_assignments integer := 0;
  invalid_class_student_refs integer := 0;
  class_capacity_exceeded integer := 0;
  student_class_type_mismatch integer := 0;
  typed_student_without_active_class integer := 0;
  duplicate_active_cpf integer := 0;
  archive_state_mismatch integer := 0;
  active_class_schedule_missing integer := 0;
  makeup_capacity_exceeded integer := 0;
  makeup_booking_class_mismatch integer := 0;
  makeup_status_timestamp_mismatch integer := 0;
  future_auto_slot_invalid_class integer := 0;
  lesson_orphan_class integer := 0;
  frequency_invalid_subject_ref integer := 0;
  tuition_subject_mismatch integer := 0;
  payment_attempt_subject_mismatch integer := 0;
  archived_class_memberships integer := 0;
  active_billing_archived_students integer := 0;
  multiple_lesson_sessions integer := 0;
  metrics_value jsonb;
  issues_value jsonb;
begin
  create temporary table if not exists pg_temp.operational_data_quality_issues (
    issue_code text,
    severity text,
    details jsonb
  ) on commit drop;
  truncate pg_temp.operational_data_quality_issues;

  select count(*)::integer into orphan_class_assignments
  from public.class_students cs
  left join public.teacher_classes tc on tc.class_number = cs.class_number
  where tc.class_number is null;

  select count(*)::integer into invalid_class_student_refs
  from public.class_students cs
  where (cs.user_id is null and cs.invite_id is null)
     or (cs.user_id is not null and cs.invite_id is not null);

  select count(*)::integer into class_capacity_exceeded
  from (
    select tc.class_number
    from public.teacher_classes tc
    left join public.class_students cs on cs.class_number = tc.class_number
    left join public.profiles p on p.id = cs.user_id
    where tc.is_active = true
    group by tc.class_number
    having count(cs.id) filter (
      where cs.invite_id is not null
         or (cs.user_id is not null and coalesce(p.enrolled, false) = true and coalesce(p.archived, false) = false)
    ) > private.get_class_operational_capacity(tc.class_number)
  ) over_capacity;

  select count(*)::integer into student_class_type_mismatch
  from public.class_students cs
  join public.profiles p on p.id = cs.user_id
  join public.teacher_classes tc on tc.class_number = cs.class_number
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and tc.is_active = true
    and p.class_type is not null
    and (case p.class_type when 'INDIVIDUAL' then 'individual' when 'QUARTETO' then 'quartet' when '8 ALUNOS' then 'eight_students' else null end) is distinct from tc.class_type;

  select count(*)::integer into typed_student_without_active_class
  from public.profiles p
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and p.class_type is not null
    and not exists (
      select 1 from public.class_students cs
      join public.teacher_classes tc on tc.class_number = cs.class_number
      where cs.user_id = p.id and tc.is_active = true
    );

  select count(*)::integer into duplicate_active_cpf
  from (
    select regexp_replace(p.cpf, '\D', '', 'g') as normalized_cpf
    from public.profiles p
    where coalesce(p.enrolled, false) = true
      and coalesce(p.archived, false) = false
      and nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '') is not null
    group by regexp_replace(p.cpf, '\D', '', 'g')
    having count(*) > 1
  ) duplicated;

  select count(*)::integer into archive_state_mismatch
  from public.profiles p
  where (p.archived = true and p.archived_at is null)
     or (p.archived = false and p.archived_at is not null);

  select count(*)::integer into active_class_schedule_missing
  from public.teacher_classes tc
  where tc.is_active = true
    and upper(btrim(tc.class_name)) <> 'INDETERMINADA'
    and (tc.class_type is null or tc.class_weekday is null or tc.class_start_time is null);

  select count(*)::integer into makeup_capacity_exceeded
  from (
    select s.id
    from public.makeup_class_slots s
    left join public.makeup_class_bookings b on b.slot_id = s.id and b.status = 'confirmed'
    group by s.id, s.capacity
    having count(b.id) > s.capacity
  ) over_capacity;

  select count(*)::integer into makeup_booking_class_mismatch
  from public.makeup_class_bookings b
  join public.makeup_class_slots s on s.id = b.slot_id
  where s.class_number is not null and b.class_number <> s.class_number;

  select count(*)::integer into makeup_status_timestamp_mismatch
  from public.makeup_class_bookings b
  where (b.status = 'cancelled' and b.cancelled_at is null)
     or (b.status = 'confirmed' and b.cancelled_at is not null);

  select count(*)::integer into future_auto_slot_invalid_class
  from public.makeup_class_slots s
  left join public.teacher_classes tc on tc.class_number = s.class_number
  where s.is_auto_generated = true
    and s.is_active = true
    and s.starts_at > now()
    and (tc.class_number is null or tc.is_active = false);

  select count(*)::integer into lesson_orphan_class
  from public.class_lesson_records clr
  left join public.teacher_classes tc on tc.class_number = clr.class_number
  where tc.class_number is null;

  select count(*)::integer into frequency_invalid_subject_ref
  from public.student_frequency sf
  where (sf.user_id is null and sf.invite_id is null)
     or (sf.user_id is not null and sf.invite_id is not null);

  select count(*)::integer into tuition_subject_mismatch
  from public.monthly_tuition mt
  where mt.student_id is not null and mt.subject_ref <> mt.student_id;

  select count(*)::integer into payment_attempt_subject_mismatch
  from public.tuition_payment_attempts attempt
  join public.monthly_tuition mt on mt.id = attempt.tuition_id
  where attempt.subject_ref <> mt.subject_ref or attempt.student_id is distinct from mt.student_id;

  select count(*)::integer into archived_class_memberships
  from public.class_students cs
  join public.profiles p on p.id = cs.user_id
  where p.archived = true;

  select count(*)::integer into active_billing_archived_students
  from public.student_billing_settings billing
  join public.profiles p on p.id = billing.student_id
  where billing.active = true and p.archived = true;

  select count(*)::integer into multiple_lesson_sessions
  from (
    select clr.class_number, clr.class_date, coalesce(clr.user_id::text, 'invite:' || clr.invite_id::text)
    from public.class_lesson_records clr
    group by clr.class_number, clr.class_date, coalesce(clr.user_id::text, 'invite:' || clr.invite_id::text)
    having count(*) > 1
  ) sessions;

  if orphan_class_assignments > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_orphan_class_assignments','critical',jsonb_build_object('count',orphan_class_assignments)); end if;
  if invalid_class_student_refs > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_invalid_class_student_refs','critical',jsonb_build_object('count',invalid_class_student_refs)); end if;
  if class_capacity_exceeded > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_class_capacity_exceeded','critical',jsonb_build_object('count',class_capacity_exceeded)); end if;
  if student_class_type_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_student_class_type_mismatch','warning',jsonb_build_object('count',student_class_type_mismatch)); end if;
  if typed_student_without_active_class > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_typed_student_without_active_class','warning',jsonb_build_object('count',typed_student_without_active_class)); end if;
  if duplicate_active_cpf > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_duplicate_active_cpf','critical',jsonb_build_object('count',duplicate_active_cpf)); end if;
  if archive_state_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_archive_state_mismatch','warning',jsonb_build_object('count',archive_state_mismatch)); end if;
  if active_class_schedule_missing > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_active_class_schedule_missing','warning',jsonb_build_object('count',active_class_schedule_missing)); end if;
  if makeup_capacity_exceeded > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_capacity_exceeded','critical',jsonb_build_object('count',makeup_capacity_exceeded)); end if;
  if makeup_booking_class_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_booking_class_mismatch','warning',jsonb_build_object('count',makeup_booking_class_mismatch)); end if;
  if makeup_status_timestamp_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_status_timestamp_mismatch','warning',jsonb_build_object('count',makeup_status_timestamp_mismatch)); end if;
  if future_auto_slot_invalid_class > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_future_auto_slot_invalid_class','warning',jsonb_build_object('count',future_auto_slot_invalid_class)); end if;
  if lesson_orphan_class > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_lesson_orphan_class','warning',jsonb_build_object('count',lesson_orphan_class)); end if;
  if frequency_invalid_subject_ref > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_frequency_invalid_subject_ref','critical',jsonb_build_object('count',frequency_invalid_subject_ref)); end if;
  if tuition_subject_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_tuition_subject_mismatch','critical',jsonb_build_object('count',tuition_subject_mismatch)); end if;
  if payment_attempt_subject_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_payment_attempt_subject_mismatch','critical',jsonb_build_object('count',payment_attempt_subject_mismatch)); end if;

  select count(*) filter (where severity='warning')::integer,
         count(*) filter (where severity='critical')::integer,
         coalesce(jsonb_agg(jsonb_build_object('code',issue_code,'severity',severity,'details',details) order by issue_code),'[]'::jsonb)
  into warning_count_value, critical_count_value, issues_value
  from pg_temp.operational_data_quality_issues;

  warning_count_value := coalesce(warning_count_value,0);
  critical_count_value := coalesce(critical_count_value,0);
  issue_count_value := warning_count_value + critical_count_value;
  if critical_count_value > 0 then
    health_status := 'critical';
  elsif warning_count_value > 0 then
    health_status := 'degraded';
  end if;

  metrics_value := jsonb_build_object(
    'orphan_class_assignments',orphan_class_assignments,
    'invalid_class_student_refs',invalid_class_student_refs,
    'class_capacity_exceeded',class_capacity_exceeded,
    'student_class_type_mismatch',student_class_type_mismatch,
    'typed_student_without_active_class',typed_student_without_active_class,
    'duplicate_active_cpf',duplicate_active_cpf,
    'archive_state_mismatch',archive_state_mismatch,
    'active_class_schedule_missing',active_class_schedule_missing,
    'makeup_capacity_exceeded',makeup_capacity_exceeded,
    'makeup_booking_class_mismatch',makeup_booking_class_mismatch,
    'makeup_status_timestamp_mismatch',makeup_status_timestamp_mismatch,
    'future_auto_slot_invalid_class',future_auto_slot_invalid_class,
    'lesson_orphan_class',lesson_orphan_class,
    'frequency_invalid_subject_ref',frequency_invalid_subject_ref,
    'tuition_subject_mismatch',tuition_subject_mismatch,
    'payment_attempt_subject_mismatch',payment_attempt_subject_mismatch,
    'archived_class_memberships_info',archived_class_memberships,
    'active_billing_archived_students_info',active_billing_archived_students,
    'multiple_lesson_sessions_info',multiple_lesson_sessions
  );

  completed_at_value := now();
  insert into private.operational_data_quality_runs(status,issue_count,critical_count,warning_count,metrics,issues,started_at,completed_at)
  values (health_status,issue_count_value,critical_count_value,warning_count_value,metrics_value,issues_value,started_at_value,completed_at_value)
  returning id into run_id;

  if target_notify then
    for issue_record in select issue_code,severity,details from pg_temp.operational_data_quality_issues loop
      perform private.enqueue_system_health_alert(
        issue_record.issue_code,
        issue_record.severity,
        'data-quality:' || issue_record.issue_code || ':' || pg_catalog.md5(issue_record.details::text),
        issue_record.details || jsonb_build_object('data_quality_run_id',run_id,'data_quality_status',health_status)
      );
    end loop;
  end if;

  delete from private.operational_data_quality_runs where completed_at < now() - interval '90 days';

  return jsonb_build_object('id',run_id,'status',health_status,'issue_count',issue_count_value,'critical_count',critical_count_value,'warning_count',warning_count_value,'metrics',metrics_value,'issues',issues_value,'completed_at',completed_at_value);
end;
$$;

revoke all on function private.run_operational_data_quality_check(boolean) from public, anon, authenticated;
grant execute on function private.run_operational_data_quality_check(boolean) to service_role;

create or replace function private.system_health_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_health_at timestamptz;
  last_data_quality_at timestamptz;
  activated_at_value timestamptz;
  retried_alerts integer := 0;
  stalled integer := 0;
  data_quality_stalled integer := 0;
  bootstrap_grace boolean := false;
  bucket_key text := to_char(date_trunc('hour', now()) at time zone 'UTC', 'YYYYMMDDHH24');
begin
  select max(r.completed_at) into last_health_at from private.system_health_runs r;
  select max(r.completed_at) into last_data_quality_at from private.operational_data_quality_runs r;
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

  update private.system_health_alerts a set status='pending',updated_at=now()
  where a.status='failed' and a.attempts<5 and coalesce(a.last_attempt_at,a.created_at)<now()-interval '10 minutes';
  get diagnostics retried_alerts = row_count;

  return jsonb_build_object('stalled',stalled,'data_quality_stalled',data_quality_stalled,'bootstrap_grace',bootstrap_grace,'retried_alerts',retried_alerts,'last_health_at',last_health_at,'last_data_quality_at',last_data_quality_at);
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
  probes jsonb;
  crons jsonb;
  alerts jsonb;
begin
  select to_jsonb(r) into latest_health from (select id,status,issue_count,critical_count,warning_count,metrics,issues,completed_at from private.system_health_runs order by completed_at desc limit 1) r;
  select to_jsonb(r) into latest_data_quality from (select id,status,issue_count,critical_count,warning_count,metrics,issues,completed_at from private.operational_data_quality_runs order by completed_at desc limit 1) r;

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
    ('operational-data-quality-health-check',90)
  )
  select coalesce(jsonb_agg(jsonb_build_object('jobname',m.jobname,'active',coalesce(j.active,false),'last_status',latest.status,'last_run_at',latest.start_time,'last_completed_at',latest.end_time,'stale',j.jobid is null or latest.end_time is null or latest.end_time < now()-make_interval(mins=>m.max_age_minutes)) order by m.jobname),'[]'::jsonb) into crons
  from monitored m
  left join cron.job j on j.jobname=m.jobname
  left join lateral (select d.status,d.start_time,d.end_time from cron.job_run_details d where d.jobid=j.jobid order by d.start_time desc limit 1) latest on true;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) into alerts
  from (select id,issue_code,severity,status,attempts,details,last_error,created_at,sent_at from private.system_health_alerts order by created_at desc limit 20) a;

  return jsonb_build_object('health',latest_health,'data_quality',latest_data_quality,'probes',probes,'crons',crons,'alerts',alerts,'generated_at',now());
end;
$$;

revoke all on function public.get_system_health_dashboard_internal() from public, anon, authenticated;
grant execute on function public.get_system_health_dashboard_internal() to service_role;

do $$
declare existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname='operational-data-quality-health-check' limit 1;
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  perform cron.schedule('operational-data-quality-health-check','12,42 * * * *','select private.run_operational_data_quality_check(true);');
end;
$$;

select private.run_operational_data_quality_check(false);