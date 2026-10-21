-- Financial changes may allocate missing lessons but never silently move
-- confirmed contractual lessons or alter the number already purchased.
CREATE OR REPLACE FUNCTION private.sync_lesson_credits_for_tuition(target_tuition_id uuid)
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

  -- Serialize payments and contractual allocations for this student.
  perform pg_advisory_xact_lock(hashtextextended(tuition_row.student_id::text, 0));

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

  -- Freeze the purchased lesson quantity after initial issuance, even
  -- when later billing-plan changes have a different lesson count.
  select coalesce(
    nullif((
      select count(*)::smallint
      from private.lesson_credits existing
      where existing.tuition_id = tuition_row.id
        and existing.credit_origin = 'contract'
    ), 0),
    (
      select settings.classes_per_month
      from public.student_billing_settings settings
      where settings.student_id = tuition_row.student_id
    )
  ) into contracted_count;

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
    when exists (
      select 1 from private.lesson_credit_revocation_justifications reason
      where reason.credit_id = credit.id
    ) then credit.revoked_at
    else null
  end
  where credit.tuition_id = tuition_row.id
    and credit.credit_origin = 'contract';

  -- Generate only the missing dates; previously assigned credits are immutable.
  with pending_credits as (
    select
      generated.credit_number::smallint as credit_number,
      row_number() over (order by generated.credit_number) as pending_position
    from generate_series(1, contracted_count::integer) as generated(credit_number)
    left join private.lesson_credits existing
      on existing.tuition_id = tuition_row.id
     and existing.credit_number = generated.credit_number
    where existing.id is null
      or (
        existing.credit_origin = 'contract'
        and existing.status = 'available'
        and existing.revoked_at is null
        and existing.cancelled_at is null
        and existing.makeup_booking_id is null
        and existing.regular_class_number is null
        and existing.regular_starts_at is null
      )
  ),
  candidate_occurrences as (
    select
      row_number() over (
        order by
          ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') asc,
          class.class_number asc
      ) as occurrence_number,
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
      (coverage_start + 180)::timestamp,
      interval '1 day'
    ) as lesson_day
    where membership.user_id = tuition_row.student_id
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
      and (class.first_lesson_date is null or lesson_day::date >= class.first_lesson_date)
      and (
        membership.first_lesson_date is null
        or lesson_day::date >= membership.first_lesson_date
      )
      -- A new student's contract cannot include a lesson that began before joining.
      -- Explicit first dates take precedence; already-allocated slots remain intact.
      and (
        membership.first_lesson_date is not null
        or ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') >= membership.created_at
        or exists (
          select 1
          from private.lesson_credits historical_credit
          where historical_credit.student_id = tuition_row.student_id
            and historical_credit.tuition_id = tuition_row.id
            and historical_credit.credit_origin = 'contract'
            and historical_credit.regular_class_number = class.class_number
            and historical_credit.regular_starts_at =
              ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo')
        )
      )
      -- All existing paid scheduled lessons, including this same invoice,
      -- retain ownership of their original day and class.
      and not exists (
        select 1
        from private.lesson_credits claimed
        join public.monthly_tuition claimed_tuition
          on claimed_tuition.id = claimed.tuition_id
        where claimed.student_id = tuition_row.student_id
          and claimed.credit_origin = 'contract'
          and claimed.revoked_at is null
          and claimed.status in ('scheduled', 'used')
          and claimed.regular_class_number = class.class_number
          and claimed.regular_starts_at =
            ((lesson_day::date + class.class_start_time)
              at time zone 'America/Sao_Paulo')
          and (claimed_tuition.payment_date is not null
            or coalesce(claimed_tuition.is_exempt, false))
      )
      -- Earlier paid contractual lessons own their dates, even if the
      -- fourth lesson extends beyond the next invoice due date.
      -- Check only earlier cycles so a later invoice cannot displace them.
      and not exists (
        select 1
        from private.lesson_credits earlier_credit
        join public.monthly_tuition earlier_tuition
          on earlier_tuition.id = earlier_credit.tuition_id
        where earlier_credit.student_id = tuition_row.student_id
          and earlier_credit.credit_origin = 'contract'
          and earlier_credit.revoked_at is null
          and earlier_credit.regular_class_number = class.class_number
          and earlier_credit.regular_starts_at =
            ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo')
          and (
            earlier_tuition.due_date < tuition_row.due_date
            or (
              earlier_tuition.due_date = tuition_row.due_date
              and earlier_tuition.reference_month < tuition_row.reference_month
            )
          )
      )
  ),
  desired_credits as (
    select
      pending.credit_number,
      occurrence.class_number,
      occurrence.class_name,
      occurrence.starts_at,
      occurrence.ends_at
    from pending_credits pending
    left join candidate_occurrences occurrence
      on occurrence.occurrence_number = pending.pending_position
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
    status = excluded.status,
    regular_class_number = excluded.regular_class_number,
    regular_class_name = excluded.regular_class_name,
    regular_starts_at = excluded.regular_starts_at,
    regular_ends_at = excluded.regular_ends_at
  where private.lesson_credits.credit_origin = 'contract'
    and private.lesson_credits.status = 'available'
    and private.lesson_credits.revoked_at is null
    and private.lesson_credits.cancelled_at is null
    and private.lesson_credits.makeup_booking_id is null
    and private.lesson_credits.regular_class_number is null
    and private.lesson_credits.regular_starts_at is null;
end;
$function$
;

-- A confirmed regular slot can belong to only one active contractual credit
-- for the same student, even when two monthly invoices overlap.
create unique index if not exists lesson_credits_unique_active_regular_slot
on private.lesson_credits (student_id, regular_class_number, regular_starts_at)
where credit_origin = 'contract'
  and status = 'scheduled'
  and revoked_at is null
  and cancelled_at is null
  and regular_class_number is not null
  and regular_starts_at is not null;

revoke all on function private.sync_lesson_credits_for_tuition(uuid) from public, anon, authenticated;

-- New enrollments on a lesson weekday begin the following week.
CREATE OR REPLACE FUNCTION private.assign_first_lesson_after_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  scheduled_weekday smallint;
  scheduled_time time without time zone;
  class_first_date date;
  assignment_time timestamptz := coalesce(new.created_at, statement_timestamp());
  candidate_date date;
begin
  select tc.class_weekday, tc.class_start_time, tc.first_lesson_date
  into scheduled_weekday, scheduled_time, class_first_date
  from public.teacher_classes tc
  where tc.class_number = new.class_number;

  if scheduled_weekday is null or scheduled_time is null then
    return new;
  end if;

  candidate_date := (assignment_time at time zone 'America/Sao_Paulo')::date;
  candidate_date := candidate_date
    + ((scheduled_weekday::integer - extract(isodow from candidate_date)::integer + 7) % 7);

  -- Enrollment on the same weekday starts in the following week, even
  -- when the lesson has not started yet.
  if candidate_date = (assignment_time at time zone 'America/Sao_Paulo')::date then
    candidate_date := candidate_date + 7;
  end if;

  -- A lesson that has already started cannot be the student's first lesson.
  if ((candidate_date + scheduled_time) at time zone 'America/Sao_Paulo')
     <= assignment_time then
    candidate_date := candidate_date + 7;
  end if;

  -- Respect a class-level start date and any later explicit student date.
  if class_first_date is not null and candidate_date < class_first_date then
    candidate_date := class_first_date
      + ((scheduled_weekday::integer - extract(isodow from class_first_date)::integer + 7) % 7);
  end if;

  new.first_lesson_date := greatest(
    coalesce(new.first_lesson_date, candidate_date),
    candidate_date
  );

  return new;
end;
$function$
;

revoke all on function private.assign_first_lesson_after_membership() from public, anon, authenticated;
