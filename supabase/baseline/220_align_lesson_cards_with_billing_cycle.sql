-- Align lesson access and generated lesson cards with the student's billing cycle.
-- A settled tuition remains active from its due date until the next tuition due date.
-- Existing cancellation and replacement history is preserved during resynchronization.

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
        and next_tuition.due_date > tuition.due_date
    ),
    (tuition.due_date + interval '1 month')::date
  )
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id;
$function$;

revoke execute on function private.get_tuition_coverage_end(uuid) from public, anon, authenticated;
grant execute on function private.get_tuition_coverage_end(uuid) to service_role;

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
    and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
    and tuition.due_date <= target_date
    and target_date < private.get_tuition_coverage_end(tuition.id)
  order by tuition.due_date desc, tuition.reference_month desc
  limit 1;
$function$;

revoke execute on function private.get_active_settled_tuition_id(uuid, date) from public, anon, authenticated;
grant execute on function private.get_active_settled_tuition_id(uuid, date) to service_role;

create or replace function private.sync_lesson_credits_for_tuition(target_tuition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  tuition_row public.monthly_tuition%rowtype;
  contracted_count smallint;
  coverage_end date;
begin
  select tuition.*
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id;

  if not found or tuition_row.student_id is null then
    return;
  end if;

  if tuition_row.payment_date is null and coalesce(tuition_row.is_exempt, false) = false then
    update public.makeup_class_bookings booking
    set
      status = 'cancelled',
      cancelled_at = coalesce(booking.cancelled_at, now())
    where booking.id in (
      select credit.makeup_booking_id
      from private.lesson_credits credit
      where credit.tuition_id = tuition_row.id
        and credit.revoked_at is null
        and credit.makeup_booking_id is not null
    )
      and booking.status = 'confirmed';

    update private.lesson_credits credit
    set revoked_at = coalesce(credit.revoked_at, now())
    where credit.tuition_id = tuition_row.id
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

  coverage_end := private.get_tuition_coverage_end(tuition_row.id);
  if coverage_end is null or coverage_end <= tuition_row.due_date then
    coverage_end := (tuition_row.due_date + interval '1 month')::date;
  end if;

  update public.makeup_class_bookings booking
  set
    status = 'cancelled',
    cancelled_at = coalesce(booking.cancelled_at, now())
  where booking.id in (
    select credit.makeup_booking_id
    from private.lesson_credits credit
    where credit.tuition_id = tuition_row.id
      and credit.credit_number > contracted_count
      and credit.revoked_at is null
      and credit.makeup_booking_id is not null
  )
    and booking.status = 'confirmed';

  update private.lesson_credits credit
  set revoked_at = case
    when credit.credit_number > contracted_count then coalesce(credit.revoked_at, now())
    else null
  end
  where credit.tuition_id = tuition_row.id;

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
      tuition_row.due_date::timestamp,
      (coverage_end - 1)::timestamp,
      interval '1 day'
    ) as lesson_day
    where membership.user_id = tuition_row.student_id
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
  ), desired_credits as (
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
      when private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.status
      else private.lesson_credits.status
    end,
    regular_class_number = case
      when private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_class_number
      else private.lesson_credits.regular_class_number
    end,
    regular_class_name = case
      when private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_class_name
      else private.lesson_credits.regular_class_name
    end,
    regular_starts_at = case
      when private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_starts_at
      else private.lesson_credits.regular_starts_at
    end,
    regular_ends_at = case
      when private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_ends_at
      else private.lesson_credits.regular_ends_at
    end;
end;
$function$;

revoke execute on function private.sync_lesson_credits_for_tuition(uuid) from public, anon, authenticated;
grant execute on function private.sync_lesson_credits_for_tuition(uuid) to service_role;

create or replace function public.get_my_lessons_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
  current_month date := date_trunc('month', local_today)::date;
  enrolled_classes jsonb := '[]'::jsonb;
  classes_per_month smallint;
  active_tuition_id uuid;
  active_coverage_end date;
  settled boolean := false;
  has_paid_before boolean := false;
  available_credits integer := 0;
  replacement_credit_ids jsonb := '[]'::jsonb;
  active_cycle_credits integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'class_number', class.class_number,
        'class_name', class.class_name,
        'class_weekday', class.class_weekday,
        'class_start_time', class.class_start_time
      )
      order by class.class_number
    ),
    '[]'::jsonb
  )
  into enrolled_classes
  from public.class_students membership
  join public.teacher_classes class
    on class.class_number = membership.class_number
   and class.is_active = true
  where membership.user_id = caller_id;

  select settings.classes_per_month
  into classes_per_month
  from public.student_billing_settings settings
  where settings.student_id = caller_id;

  active_tuition_id := private.get_active_settled_tuition_id(caller_id, local_today);
  settled := active_tuition_id is not null;

  if active_tuition_id is not null then
    active_coverage_end := private.get_tuition_coverage_end(active_tuition_id);
  end if;

  select exists (
    select 1
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  )
  into has_paid_before;

  select
    count(*)::integer,
    coalesce(
      jsonb_agg(to_jsonb(credit.id) order by credit.cancelled_at asc, credit.id asc),
      '[]'::jsonb
    )
  into available_credits, replacement_credit_ids
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and credit.status = 'available'
    and credit.cancelled_at is not null
    and credit.regular_starts_at is not null
    and credit.cancelled_at <= credit.regular_starts_at - interval '12 hours';

  select count(*)::integer
  into active_cycle_credits
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and credit.tuition_id = active_tuition_id;

  return jsonb_build_object(
    'reference_month', current_month,
    'is_paid', settled,
    'has_paid_before', has_paid_before,
    'classes_per_month', classes_per_month,
    'available_credits', available_credits,
    'replacement_credit_ids', replacement_credit_ids,
    'current_month_credits', active_cycle_credits,
    'active_tuition_id', active_tuition_id,
    'coverage_end', active_coverage_end,
    'classes', enrolled_classes
  );
end;
$function$;

revoke execute on function public.get_my_lessons_overview() from public, anon;
grant execute on function public.get_my_lessons_overview() to authenticated, service_role;

create or replace function public.get_my_lesson_credits()
returns table(
  credit_id uuid,
  reference_month date,
  credit_number smallint,
  status text,
  class_number integer,
  class_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  meeting_url text,
  original_class_number integer,
  original_class_name text,
  original_starts_at timestamptz,
  cancellation_deadline timestamptz,
  can_cancel boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
  active_tuition_id uuid;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

  active_tuition_id := private.get_active_settled_tuition_id(caller_id, local_today);

  return query
  select
    credit.id,
    credit.reference_month,
    credit.credit_number,
    credit.status,
    case when credit.status = 'used' then booking.class_number else credit.regular_class_number end,
    case when credit.status = 'used' then booking.class_name else credit.regular_class_name end,
    case when credit.status = 'used' then slot.starts_at else credit.regular_starts_at end,
    case when credit.status = 'used' then slot.ends_at else credit.regular_ends_at end,
    case
      when credit.status = 'used' then booking.meeting_url
      else regular_resource.video_lesson_url
    end,
    credit.regular_class_number,
    credit.regular_class_name,
    credit.regular_starts_at,
    case
      when credit.status = 'used' then slot.starts_at - interval '12 hours'
      when credit.status = 'scheduled' then credit.regular_starts_at - interval '12 hours'
      else null
    end,
    case
      when credit.status = 'used' and booking.status = 'confirmed'
        then now() <= slot.starts_at - interval '12 hours'
      when credit.status = 'scheduled'
        then now() < credit.regular_starts_at
      else false
    end
  from private.lesson_credits credit
  left join public.makeup_class_bookings booking
    on booking.id = credit.makeup_booking_id
  left join public.makeup_class_slots slot
    on slot.id = booking.slot_id
  left join public.class_resources regular_resource
    on regular_resource.class_number = credit.regular_class_number
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and (
      credit.tuition_id = active_tuition_id
      or credit.status = 'available'
      or (credit.status = 'used' and slot.starts_at >= local_today::timestamp at time zone 'America/Sao_Paulo')
    )
  order by
    case when credit.status = 'available' then 1 else 0 end,
    coalesce(
      case when credit.status = 'used' then slot.starts_at else credit.regular_starts_at end,
      (credit.reference_month + interval '1 month')::timestamptz
    ) asc,
    credit.reference_month asc,
    credit.credit_number asc;
end;
$function$;

revoke execute on function public.get_my_lesson_credits() from public, anon;
grant execute on function public.get_my_lesson_credits() to authenticated, service_role;

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
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  loop
    perform private.sync_lesson_credits_for_tuition(tuition_record.id);
  end loop;
end;
$function$;

notify pgrst, 'reload schema';
