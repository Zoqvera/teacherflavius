-- Preserve teacher-approved, previously paid historical credits without rewriting
-- their contractual origin or altering the current 4-class billing plan.
-- This migration does not include student IDs or personal data.
create table if not exists private.lesson_credit_plan_exceptions (
  credit_id uuid primary key references private.lesson_credits(id) on delete cascade,
  approval_reason text not null check (char_length(btrim(approval_reason)) >= 20),
  approved_at timestamptz not null default now()
);

comment on table private.lesson_credit_plan_exceptions is
  'Explicit teacher-approved exceptions for historical contractual credits above the current plan. Only settled tuition may be exempted from excess warnings.';
alter table private.lesson_credit_plan_exceptions enable row level security;
revoke all on private.lesson_credit_plan_exceptions from public, anon, authenticated;

-- Lesson-credit audit keeps historically approved credits visible as justified
-- exceptions, while unpaid and revoked-booking anomalies retain precedence.
create or replace function private.lesson_credit_audit_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with classified as (
    select
      credit.id as credit_id,
      credit.student_id,
      coalesce(nullif(btrim(profile.name), ''), 'Aluno') as student_name,
      credit.reference_month,
      credit.credit_number,
      credit.credit_origin,
      credit.status as original_status,
      case when credit.revoked_at is not null then 'Revogado'
           when credit.status = 'available' then 'Disponível'
           when credit.status = 'scheduled' then 'Agendado'
           when credit.status = 'used' then 'Utilizado'
           else 'Perdido' end as effective_status,
      credit.revoked_at,
      approved.approval_reason,
      billing.classes_per_month as current_plan_classes,
      (tuition.payment_date is not null or coalesce(tuition.is_exempt, false)) as tuition_settled,
      case
        when credit.revoked_at is not null and booking.status = 'confirmed'
          then 'revoked_confirmed_booking'
        when credit.revoked_at is not null
         and tuition.payment_date is null and not coalesce(tuition.is_exempt, false)
          then 'revoked_unpaid'
        when credit.revoked_at is not null
         and credit.credit_origin = 'contract'
         and billing.classes_per_month is not null
         and credit.credit_number > billing.classes_per_month
          then 'revoked_excess'
        when credit.revoked_at is not null then 'revoked_review'
        when credit.credit_origin = 'contract'
         and tuition.payment_date is null and not coalesce(tuition.is_exempt, false)
          then 'active_unpaid'
        when credit.credit_origin = 'contract'
         and billing.classes_per_month is not null
         and credit.credit_number > billing.classes_per_month
         and exception.credit_id is not null
          then 'approved_historical_exception'
        when credit.credit_origin = 'contract'
         and billing.classes_per_month is not null
         and credit.credit_number > billing.classes_per_month
          then 'active_excess'
        else null
      end as classification
    from private.lesson_credits credit
    join public.monthly_tuition tuition on tuition.id = credit.tuition_id
    left join public.student_billing_settings billing on billing.student_id = credit.student_id
    left join public.profiles profile on profile.id = credit.student_id
    left join public.makeup_class_bookings booking on booking.id = credit.makeup_booking_id
    left join private.lesson_credit_plan_exceptions approved on approved.credit_id = credit.id
  ),
  totals as (
    select
      count(*) filter (where revoked_at is not null)::integer as revoked_total,
      count(*) filter (where classification = 'revoked_unpaid')::integer as revoked_unpaid,
      count(*) filter (where classification = 'revoked_excess')::integer as revoked_excess,
      count(*) filter (where classification = 'revoked_review')::integer as revoked_review,
      count(*) filter (where classification = 'revoked_confirmed_booking')::integer as revoked_confirmed_booking,
      count(*) filter (where classification = 'active_unpaid')::integer as active_unpaid,
      count(*) filter (where classification = 'active_excess')::integer as active_excess,
      count(*) filter (where classification = 'approved_historical_exception')::integer as approved_historical_exception
    from classified
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'revoked_total', totals.revoked_total,
      'revoked_unpaid', totals.revoked_unpaid,
      'revoked_excess', totals.revoked_excess,
      'revoked_review', totals.revoked_review,
      'revoked_confirmed_booking', totals.revoked_confirmed_booking,
      'active_unpaid', totals.active_unpaid,
      'active_excess', totals.active_excess,
      'approved_historical_exception', totals.approved_historical_exception
    ),
    'credits', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.reference_month desc, item.credit_number)
      from (
        select
          credit_id, student_name, reference_month, credit_number,
          credit_origin, original_status, effective_status, revoked_at,
          current_plan_classes, tuition_settled, classification, approval_reason
        from classified
        where classification is not null
        order by
          case classification
            when 'revoked_confirmed_booking' then 1
            when 'active_unpaid' then 2
            when 'revoked_review' then 3
            when 'active_excess' then 4
            else 5
          end, reference_month desc, credit_number
        limit 100
      ) item
    ), '[]'::jsonb),
    'details_limit', 100
  )
  from totals;
$function$
;

-- Never revoke a grandfathered credit when a paid tuition is resynchronized.
create or replace function private.sync_lesson_credits_for_tuition(target_tuition_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  tuition_row public.monthly_tuition%rowtype;
  contracted_count smallint;
  coverage_start date;
  coverage_end date;
begin
  select tuition.*
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id;

  if not found or tuition_row.student_id is null then
    return;
  end if;

  if tuition_row.payment_date is null
     and coalesce(tuition_row.is_exempt, false) = false then
    update public.makeup_class_bookings booking
    set
      status = 'cancelled',
      cancelled_at = coalesce(booking.cancelled_at, now())
    where booking.id in (
      select credit.makeup_booking_id
      from private.lesson_credits credit
      where credit.tuition_id = tuition_row.id
        and credit.credit_origin = 'contract'
        and credit.revoked_at is null
        and credit.makeup_booking_id is not null
    )
      and booking.status = 'confirmed';

    update private.lesson_credits credit
    set revoked_at = coalesce(credit.revoked_at, now())
    where credit.tuition_id = tuition_row.id
      and credit.credit_origin = 'contract'
      and credit.revoked_at is null;

    return;
  end if;

  select settings.classes_per_month
  into contracted_count
  from public.student_billing_settings settings
  where settings.student_id = tuition_row.student_id;

  if contracted_count is null then
    return;
  end if;

  coverage_start := private.get_tuition_coverage_start(tuition_row.id);
  coverage_end := private.get_tuition_coverage_end(tuition_row.id);

  if coverage_start is null then
    coverage_start := tuition_row.due_date;
  end if;

  if coverage_end is null or coverage_end <= coverage_start then
    coverage_end := (coverage_start + interval '1 month')::date;
  end if;

  update public.makeup_class_bookings booking
  set
    status = 'cancelled',
    cancelled_at = coalesce(booking.cancelled_at, now())
  where booking.id in (
    select credit.makeup_booking_id
    from private.lesson_credits credit
    where credit.tuition_id = tuition_row.id
      and credit.credit_origin = 'contract'
      and credit.credit_number > contracted_count
      and not exists (
        select 1 from private.lesson_credit_plan_exceptions approved
        where approved.credit_id = credit.id
      )
      and credit.revoked_at is null
      and credit.makeup_booking_id is not null
  )
    and booking.status = 'confirmed';

  update private.lesson_credits credit
  set revoked_at = case
    when credit.credit_number > contracted_count
      and not exists (
        select 1 from private.lesson_credit_plan_exceptions approved
        where approved.credit_id = credit.id
      )
      then coalesce(credit.revoked_at, now())
    else null
  end
  where credit.tuition_id = tuition_row.id
    and credit.credit_origin = 'contract';

  with candidate_occurrences as (
    select
      row_number() over (
        order by
          ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') asc,
          class.class_number asc
      )::smallint as credit_number,
      class.class_number,
      class.class_name,
      ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      (((lesson_day::date + class.class_start_time) + interval '1 hour') at time zone 'America/Sao_Paulo') as ends_at
    from public.class_students membership
    join public.teacher_classes class
      on class.class_number = membership.class_number
     and class.is_active = true
    cross join generate_series(
      coverage_start::timestamp,
      (coverage_end - 1)::timestamp,
      interval '1 day'
    ) as lesson_day
    where membership.user_id = tuition_row.student_id
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
  ),
  desired_credits as (
    select
      series.credit_number::smallint as credit_number,
      occurrence.class_number,
      occurrence.class_name,
      occurrence.starts_at,
      occurrence.ends_at
    from generate_series(1, contracted_count::integer) as series(credit_number)
    left join candidate_occurrences occurrence
      on occurrence.credit_number = series.credit_number
  )
  insert into private.lesson_credits (
    student_id,
    tuition_id,
    reference_month,
    credit_number,
    status,
    credit_origin,
    regular_class_number,
    regular_class_name,
    regular_starts_at,
    regular_ends_at,
    revoked_at
  )
  select
    tuition_row.student_id,
    tuition_row.id,
    tuition_row.reference_month,
    desired.credit_number,
    case when desired.starts_at is null then 'available' else 'scheduled' end,
    'contract',
    desired.class_number,
    desired.class_name,
    desired.starts_at,
    desired.ends_at,
    null
  from desired_credits desired
  on conflict (tuition_id, credit_number) do update
  set
    revoked_at = null,
    status = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.status
      else private.lesson_credits.status
    end,
    regular_class_number = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_class_number
      else private.lesson_credits.regular_class_number
    end,
    regular_class_name = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_class_name
      else private.lesson_credits.regular_class_name
    end,
    regular_starts_at = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_starts_at
      else private.lesson_credits.regular_starts_at
    end,
    regular_ends_at = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_ends_at
      else private.lesson_credits.regular_ends_at
    end;
end;
$function$
;

-- Detect class assignments whose auth account has lost its public profile.
create or replace function private.run_operational_data_quality_check(target_notify boolean DEFAULT true)
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
  class_memberships_without_profile integer := 0;
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
  course_billing_contradictions integer := 0;
  unjustified_inactive_student_billing integer := 0;
  course_membership_state_conflicts integer := 0;
  tuition_subject_mismatch integer := 0;
  payment_attempt_subject_mismatch integer := 0;
  archived_class_memberships integer := 0;
  active_billing_archived_students integer := 0;
  multiple_lesson_sessions integer := 0;
  lesson_credit_audit jsonb;
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

  select count(*)::integer into class_memberships_without_profile
  from public.class_students cs
  left join public.profiles profile on profile.id = cs.user_id
  where cs.user_id is not null and profile.id is null;

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

  select count(*)::integer into unjustified_inactive_student_billing
  from public.profiles p
  join public.student_billing_settings b on b.student_id=p.id
  left join public.student_course_states s on s.student_id=p.id
  where p.enrolled=true and coalesce(p.archived,false)=false
    and b.active=false
    and coalesce(s.course_status,'') <> 'paused'
    and coalesce(s.billing_exemption,'none') <> 'permanent';

  select count(*)::integer into course_membership_state_conflicts
  from public.student_course_states s
  join public.profiles p on p.id=s.student_id
  cross join lateral (
    select count(*) as class_count from public.class_students cs
    join public.teacher_classes tc on tc.class_number=cs.class_number
    where cs.user_id=s.student_id and tc.is_active=true
      and tc.class_type in ('quintet','individual')
  ) members
  where p.enrolled=true and coalesce(p.archived,false)=false
    and ((s.course_status='active' and members.class_count=0)
      or (s.course_status in ('paused','awaiting_class') and members.class_count>0));

  select count(*)::integer into course_billing_contradictions
  from public.student_course_states s
  join public.student_billing_settings b on b.student_id=s.student_id
  where (s.course_status='paused' or s.billing_exemption='permanent') and b.active=true;

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
  if class_memberships_without_profile > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_class_membership_without_profile','warning',jsonb_build_object('count',class_memberships_without_profile)); end if;
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
  if unjustified_inactive_student_billing > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_inactive_student_billing_without_exception',
      'warning',jsonb_build_object('count',unjustified_inactive_student_billing));
  end if;
  if course_membership_state_conflicts > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_course_membership_state_conflict',
      'warning',jsonb_build_object('count',course_membership_state_conflicts));
  end if;
  if course_billing_contradictions > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_course_billing_contradiction','warning',
      jsonb_build_object('count',course_billing_contradictions));
  end if;
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


  lesson_credit_audit := private.lesson_credit_audit_snapshot();

  if (lesson_credit_audit #>> '{summary,revoked_confirmed_booking}')::integer > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_revoked_credit_confirmed_booking', 'critical',
      jsonb_build_object('count', (lesson_credit_audit #>> '{summary,revoked_confirmed_booking}')::integer));
  end if;

  if (lesson_credit_audit #>> '{summary,active_unpaid}')::integer > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_active_credit_unpaid_tuition', 'critical',
      jsonb_build_object('count', (lesson_credit_audit #>> '{summary,active_unpaid}')::integer));
  end if;

  if (lesson_credit_audit #>> '{summary,revoked_review}')::integer > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_credit_revocation_requires_review', 'warning',
      jsonb_build_object('count', (lesson_credit_audit #>> '{summary,revoked_review}')::integer));
  end if;

  if (lesson_credit_audit #>> '{summary,active_excess}')::integer > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_legacy_credit_plan_review', 'warning',
      jsonb_build_object('count', (lesson_credit_audit #>> '{summary,active_excess}')::integer));
  end if;

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
    'class_memberships_without_profile',class_memberships_without_profile,
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
    'course_billing_contradictions',course_billing_contradictions,
    'unjustified_inactive_student_billing',unjustified_inactive_student_billing,
    'course_membership_state_conflicts',course_membership_state_conflicts,
    'course_paused_students_info',(select count(*) from public.student_course_states where course_status='paused'),
    'course_awaiting_class_students_info',(select count(*) from public.student_course_states where course_status='awaiting_class'),
    'permanent_tuition_exempt_students_info',(select count(*) from public.student_course_states where billing_exemption='permanent'),
    'tuition_subject_mismatch',tuition_subject_mismatch,
    'payment_attempt_subject_mismatch',payment_attempt_subject_mismatch,
    'archived_class_memberships_info',archived_class_memberships,
    'active_billing_archived_students_info',active_billing_archived_students,
    'multiple_lesson_sessions_info',multiple_lesson_sessions
  );


  metrics_value := metrics_value || jsonb_build_object(
    'lesson_credit_audit', lesson_credit_audit -> 'summary'
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
