-- Activate the first settled tuition as soon as it is paid/exempted.
-- Subsequent billing cycles still begin on their own due dates.
-- Lesson cards are synchronized from the effective coverage start, preserving manual credits and cancellation history.

create or replace function private.get_tuition_coverage_start(target_tuition_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $function$
  select
    case
      when exists (
        select 1
        from public.monthly_tuition previous_tuition
        where previous_tuition.student_id = tuition.student_id
          and previous_tuition.reference_month < tuition.reference_month
      )
        then tuition.due_date
      else coalesce(
        tuition.payment_date,
        (tuition.exempted_at at time zone 'America/Sao_Paulo')::date,
        tuition.due_date
      )
    end
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id;
$function$;

revoke execute on function private.get_tuition_coverage_start(uuid)
  from public, anon, authenticated;
grant execute on function private.get_tuition_coverage_start(uuid)
  to service_role;

create or replace function private.get_tuition_coverage_end(target_tuition_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select min(next_tuition.due_date)
      from public.monthly_tuition next_tuition
      where next_tuition.student_id = tuition.student_id
        and next_tuition.reference_month > tuition.reference_month
    ),
    (tuition.due_date + interval '1 month')::date
  )
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id;
$function$;

revoke execute on function private.get_tuition_coverage_end(uuid)
  from public, anon, authenticated;
grant execute on function private.get_tuition_coverage_end(uuid)
  to service_role;

create or replace function private.get_active_settled_tuition_id(
  target_student_id uuid,
  target_date date
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select tuition.id
  from public.monthly_tuition tuition
  where tuition.student_id = target_student_id
    and (
      tuition.payment_date is not null
      or coalesce(tuition.is_exempt, false) = true
    )
    and private.get_tuition_coverage_start(tuition.id) <= target_date
    and target_date < private.get_tuition_coverage_end(tuition.id)
  order by tuition.reference_month desc, tuition.due_date desc
  limit 1;
$function$;

revoke execute on function private.get_active_settled_tuition_id(uuid, date)
  from public, anon, authenticated;
grant execute on function private.get_active_settled_tuition_id(uuid, date)
  to service_role;

create or replace function private.sync_lesson_credits_for_tuition(target_tuition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
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
      and credit.revoked_at is null
      and credit.makeup_booking_id is not null
  )
    and booking.status = 'confirmed';

  update private.lesson_credits credit
  set revoked_at = case
    when credit.credit_number > contracted_count
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
$function$;

revoke execute on function private.sync_lesson_credits_for_tuition(uuid)
  from public, anon, authenticated;
grant execute on function private.sync_lesson_credits_for_tuition(uuid)
  to service_role;

do $function$
declare
  tuition_record record;
begin
  for tuition_record in
    select tuition.id
    from public.monthly_tuition tuition
    join public.student_billing_settings settings
      on settings.student_id = tuition.student_id
    where settings.classes_per_month is not null
      and (
        tuition.payment_date is not null
        or coalesce(tuition.is_exempt, false) = true
      )
      and not exists (
        select 1
        from public.monthly_tuition previous_tuition
        where previous_tuition.student_id = tuition.student_id
          and previous_tuition.reference_month < tuition.reference_month
      )
  loop
    perform private.sync_lesson_credits_for_tuition(tuition_record.id);
  end loop;
end;
$function$;

notify pgrst, 'reload schema';
