-- First contracted lesson may start after enrollment, without moving tuition due dates.
alter table public.class_students
  add column if not exists first_lesson_date date;

comment on column public.class_students.first_lesson_date is
  'First eligible scheduled lesson for this class membership. Null leaves scheduling unchanged.';

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
      and (
        membership.first_lesson_date is null
        or lesson_day::date >= membership.first_lesson_date
      )
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
