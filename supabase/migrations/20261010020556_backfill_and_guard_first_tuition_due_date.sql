-- One-time, non-destructive backfill for legacy student profiles.
-- Financial competences, due dates, amounts and settlement data are untouched.
with legacy_first_tuition as (
  select distinct on (tuition.student_id)
    tuition.student_id,
    tuition.due_date
  from public.monthly_tuition tuition
  join public.profiles profile
    on profile.id = tuition.student_id
  join public.student_billing_settings billing
    on billing.student_id = profile.id
  where profile.enrolled = true
    and profile.archived = false
    and profile.tuition_due_day_source = 'legacy'
    and profile.tuition_first_due_date is null
    and billing.active = true
  order by tuition.student_id, tuition.reference_month, tuition.created_at, tuition.id
)
update public.profiles profile
set tuition_first_due_date = tuition.due_date
from legacy_first_tuition tuition
where profile.id = tuition.student_id
  and profile.tuition_first_due_date is null;

-- Preserve existing action types and support explicit corrections of paid history.
alter table public.monthly_tuition_events
  drop constraint if exists monthly_tuition_events_action_check;

alter table public.monthly_tuition_events
  add constraint monthly_tuition_events_action_check
  check (
    action in (
      'payment_recorded',
      'payment_reversed',
      'payment_reinstated',
      'tuition_exempted',
      'tuition_exemption_reversed',
      'duplicate_payment_detected',
      'due_date_corrected_after_enrollment',
      'historical_due_date_corrected',
      'billing_start_month_corrected'
    )
  );

-- Deferred cross-table integrity check: enrollment and billing can be saved
-- in either order within one transaction, but must be consistent at commit.
create or replace function private.assert_active_billing_has_first_due_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_student_id uuid;
begin
  if tg_relid = 'public.profiles'::regclass then
    target_student_id := new.id;
  else
    target_student_id := new.student_id;
  end if;

  if exists (
    select 1
    from public.profiles profile
    join public.student_billing_settings billing
      on billing.student_id = profile.id
    where profile.id = target_student_id
      and profile.enrolled = true
      and profile.archived = false
      and billing.active = true
      and profile.tuition_first_due_date is null
  ) then
    raise exception
      'Cobrança ativa exige data de vencimento da primeira mensalidade para o aluno %.',
      target_student_id
      using errcode = '23514';
  end if;

  return null;
end;
$function$;

revoke all on function private.assert_active_billing_has_first_due_date()
from public, anon, authenticated;

drop trigger if exists active_billing_first_due_profile_integrity on public.profiles;
create constraint trigger active_billing_first_due_profile_integrity
after insert or update of enrolled, archived, tuition_first_due_date
on public.profiles
deferrable initially deferred
for each row execute function private.assert_active_billing_has_first_due_date();

drop trigger if exists active_billing_first_due_settings_integrity on public.student_billing_settings;
create constraint trigger active_billing_first_due_settings_integrity
after insert or update of active, due_day, billing_start_month
on public.student_billing_settings
deferrable initially deferred
for each row execute function private.assert_active_billing_has_first_due_date();

-- Extend the existing operational quality check with a missing-first-due invariant.
CREATE OR REPLACE FUNCTION private.run_operational_data_quality_check(target_notify boolean DEFAULT true)
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
  lesson_future_invalid_class_reference integer := 0;
  lesson_created_after_class_deactivation integer := 0;
  lesson_deleted_class_history integer := 0;
  frequency_invalid_subject_ref integer := 0;
  active_billing_missing_first_due integer := 0;
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
    and (case p.class_type when 'INDIVIDUAL' then 'individual' when 'QUINTETO' then 'quintet' else null end) is distinct from tc.class_type;

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

  select
    count(*) filter (
      where (
        clr.class_date > (now() at time zone 'America/Sao_Paulo')::date
        and (tc.class_number is null or tc.is_active = false)
      )
      or (
        tc.class_number is not null
        and tc.is_active = false
        and clr.created_at > tc.updated_at
      )
    )::integer,
    count(*) filter (
      where clr.class_date > (now() at time zone 'America/Sao_Paulo')::date
        and (tc.class_number is null or tc.is_active = false)
    )::integer,
    count(*) filter (
      where tc.class_number is not null
        and tc.is_active = false
        and clr.created_at > tc.updated_at
    )::integer,
    count(*) filter (
      where clr.class_date <= (now() at time zone 'America/Sao_Paulo')::date
        and (tc.class_number is null or tc.is_active = false)
        and not (
          tc.class_number is not null
          and tc.is_active = false
          and clr.created_at > tc.updated_at
        )
    )::integer
  into
    lesson_orphan_class,
    lesson_future_invalid_class_reference,
    lesson_created_after_class_deactivation,
    lesson_deleted_class_history
  from public.class_lesson_records clr
  left join public.teacher_classes tc on tc.class_number = clr.class_number
  where tc.class_number is null or tc.is_active = false;

  select count(*)::integer into frequency_invalid_subject_ref
  from public.student_frequency sf
  where (sf.user_id is null and sf.invite_id is null)
     or (sf.user_id is not null and sf.invite_id is not null);

  select count(*)::integer into active_billing_missing_first_due
  from public.profiles profile
  join public.student_billing_settings billing
    on billing.student_id = profile.id
  where profile.enrolled = true
    and profile.archived = false
    and billing.active = true
    and profile.tuition_first_due_date is null;

  select count(*)::integer into tuition_subject_mismatch
  from public.monthly_tuition mt
  where mt.student_id is not null and mt.subject_ref <> mt.student_id;

  select count(*)::integer into payment_attempt_subject_mismatch
  from public.tuition_payment_attempts attempt
  join public.monthly_tuition mt on mt.id = attempt.tuition_id
  where attempt.subject_ref <> mt.subject_ref or attempt.student_id is distinct from mt.student_id;

  select count(*)::integer into archived_class_memberships
  from public.class_students cs join public.profiles p on p.id = cs.user_id
  where p.archived = true;

  select count(*)::integer into active_billing_archived_students
  from public.student_billing_settings billing join public.profiles p on p.id = billing.student_id
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
  if student_class_type_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_student_class_type_mismatch','warning',jsonb_build_object('count',student_class_type_mismatch)); end if;  -- Classified students without a class are valid while awaiting placement.  if duplicate_active_cpf > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_duplicate_active_cpf','critical',jsonb_build_object('count',duplicate_active_cpf)); end if;
  if archive_state_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_archive_state_mismatch','warning',jsonb_build_object('count',archive_state_mismatch)); end if;
  if active_class_schedule_missing > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_active_class_schedule_missing','warning',jsonb_build_object('count',active_class_schedule_missing)); end if;
  if makeup_capacity_exceeded > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_capacity_exceeded','critical',jsonb_build_object('count',makeup_capacity_exceeded)); end if;
  if makeup_booking_class_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_booking_class_mismatch','warning',jsonb_build_object('count',makeup_booking_class_mismatch)); end if;
  if makeup_status_timestamp_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_status_timestamp_mismatch','warning',jsonb_build_object('count',makeup_status_timestamp_mismatch)); end if;
  if future_auto_slot_invalid_class > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_future_auto_slot_invalid_class','warning',jsonb_build_object('count',future_auto_slot_invalid_class)); end if;
  if lesson_orphan_class > 0 then
    insert into pg_temp.operational_data_quality_issues
    values (
      'data_quality_lesson_orphan_class',
      'warning',
      jsonb_build_object(
        'count', lesson_orphan_class,
        'future_count', lesson_future_invalid_class_reference,
        'created_after_deactivation_count', lesson_created_after_class_deactivation
      )
    );
  end if;
  if frequency_invalid_subject_ref > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_frequency_invalid_subject_ref','critical',jsonb_build_object('count',frequency_invalid_subject_ref)); end if;
  if active_billing_missing_first_due > 0 then
    insert into pg_temp.operational_data_quality_issues
    values (
      'data_quality_active_billing_missing_first_due',
      'warning',
      jsonb_build_object('count', active_billing_missing_first_due)
    );
  end if;
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
  if critical_count_value > 0 then health_status := 'critical'; elsif warning_count_value > 0 then health_status := 'degraded'; end if;

  metrics_value := jsonb_build_object(
    'orphan_class_assignments',orphan_class_assignments,
    'invalid_class_student_refs',invalid_class_student_refs,
    'class_capacity_exceeded',class_capacity_exceeded,
    'student_class_type_mismatch',student_class_type_mismatch,
    'typed_student_without_active_class_info',typed_student_without_active_class,
    'duplicate_active_cpf',duplicate_active_cpf,
    'archive_state_mismatch',archive_state_mismatch,
    'active_class_schedule_missing',active_class_schedule_missing,
    'makeup_capacity_exceeded',makeup_capacity_exceeded,
    'makeup_booking_class_mismatch',makeup_booking_class_mismatch,
    'makeup_status_timestamp_mismatch',makeup_status_timestamp_mismatch,
    'future_auto_slot_invalid_class',future_auto_slot_invalid_class,
    'lesson_orphan_class',lesson_orphan_class,
    'lesson_future_invalid_class_reference',lesson_future_invalid_class_reference,
    'lesson_created_after_class_deactivation',lesson_created_after_class_deactivation,
    'lesson_deleted_class_history_info',lesson_deleted_class_history,
    'frequency_invalid_subject_ref',frequency_invalid_subject_ref,
    'active_billing_missing_first_due',active_billing_missing_first_due,
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
$function$
;
