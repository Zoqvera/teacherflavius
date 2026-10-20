-- Read-only lesson projection. Forecast rows never create contractual credits,
-- attendance, cancellation rights, or meeting-room access.
create or replace function public.get_my_lesson_forecast()
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
  active_tuition_id uuid;
  projection_start date := (now() at time zone 'America/Sao_Paulo')::date;
  preview_limit integer;
  prepaid_lessons jsonb := '[]'::jsonb;
  predicted_lessons jsonb := '[]'::jsonb;
  first_predicted_date date;
  next_payment_due_date date;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

  select least(settings.classes_per_month::integer, 8)
    into preview_limit
  from public.student_billing_settings settings
  where settings.student_id = caller_id
    and settings.active = true;

  if preview_limit is null or preview_limit < 1 then
    return jsonb_build_object(
      'prepaid_lessons', prepaid_lessons,
      'predicted_lessons', predicted_lessons,
      'next_payment_due_date', null
    );
  end if;

  active_tuition_id := private.get_active_settled_tuition_id(caller_id, local_today);
  if active_tuition_id is not null then
    projection_start := greatest(
      local_today,
      private.get_tuition_coverage_end(active_tuition_id)
    );
  end if;

  -- A paid future cycle has real, non-revoked credits. These records are
  -- informational here; the canonical lesson RPC owns all student actions.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'class_number', future.class_number,
        'class_name', future.class_name,
        'starts_at', future.starts_at,
        'status', 'confirmed'
      ) order by future.starts_at, future.class_number
    ),
    '[]'::jsonb
  )
  into prepaid_lessons
  from (
    select
      case when credit.status = 'used'
        then booking.class_number else credit.regular_class_number end as class_number,
      case when credit.status = 'used'
        then booking.class_name else credit.regular_class_name end as class_name,
      case when credit.status = 'used'
        then slot.starts_at else credit.regular_starts_at end as starts_at
    from private.lesson_credits credit
    join public.monthly_tuition tuition
      on tuition.id = credit.tuition_id
     and tuition.student_id = caller_id
     and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false))
    left join public.makeup_class_bookings booking
      on booking.id = credit.makeup_booking_id
     and booking.status = 'confirmed'
    left join public.makeup_class_slots slot
      on slot.id = booking.slot_id
    where credit.student_id = caller_id
      and credit.tuition_id is distinct from active_tuition_id
      and credit.credit_origin = 'contract'
      and credit.revoked_at is null
      and credit.status in ('scheduled', 'used')
      and (case when credit.status = 'used'
        then slot.starts_at else credit.regular_starts_at end) > now()
      and (case when credit.status = 'used'
        then slot.starts_at else credit.regular_starts_at end)
        >= (projection_start::timestamp at time zone 'America/Sao_Paulo')
    order by starts_at, class_number
    limit 16
  ) as future;

  -- Generate dates only; never write to private.lesson_credits. Do not mark
  -- any occurrence covered by a settled tuition as a forecast.
  with class_occurrences as (
    select
      class.class_number,
      class.class_name,
      lesson_day::date as lesson_date,
      ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at
    from public.class_students membership
    join public.teacher_classes class
      on class.class_number = membership.class_number
     and class.is_active = true
    cross join generate_series(
      projection_start::timestamp,
      (projection_start + 180)::timestamp,
      interval '1 day'
    ) lesson_day
    where membership.user_id = caller_id
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
      and (class.first_lesson_date is null
        or lesson_day::date >= class.first_lesson_date)
      and (membership.first_lesson_date is null
        or lesson_day::date >= membership.first_lesson_date)
      and (
        membership.first_lesson_date is not null
        or ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo')
          >= membership.created_at
      )
  ), uncovered_occurrences as (
    select occurrence.*
    from class_occurrences occurrence
    where occurrence.starts_at > now()
      and not exists (
        select 1
        from public.monthly_tuition tuition
        where tuition.student_id = caller_id
          and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false))
          and occurrence.lesson_date >= private.get_tuition_coverage_start(tuition.id)
          and occurrence.lesson_date < private.get_tuition_coverage_end(tuition.id)
      )
  ), next_occurrences as (
    select *
    from uncovered_occurrences
    order by starts_at, class_number
    limit preview_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'class_number', candidate.class_number,
          'class_name', candidate.class_name,
          'starts_at', candidate.starts_at,
          'status', 'predicted'
        ) order by candidate.starts_at, candidate.class_number
      ),
      '[]'::jsonb
    ),
    min(candidate.lesson_date)
  into predicted_lessons, first_predicted_date
  from next_occurrences candidate;

  -- Prefer the invoice covering the first projected lesson. Never invent
  -- a financial due date when no matching tuition record exists.
  if first_predicted_date is not null then
    select tuition.due_date
      into next_payment_due_date
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and tuition.payment_date is null
      and coalesce(tuition.is_exempt, false) = false
      and tuition.due_date <= first_predicted_date
      and private.get_tuition_coverage_end(tuition.id) > first_predicted_date
    order by tuition.due_date desc
    limit 1;

    if next_payment_due_date is null then
      select min(tuition.due_date)
        into next_payment_due_date
      from public.monthly_tuition tuition
      where tuition.student_id = caller_id
        and tuition.payment_date is null
        and coalesce(tuition.is_exempt, false) = false
        and tuition.due_date >= local_today;
    end if;
  end if;

  return jsonb_build_object(
    'prepaid_lessons', prepaid_lessons,
    'predicted_lessons', predicted_lessons,
    'next_payment_due_date', next_payment_due_date
  );
end;
$function$;

revoke all on function public.get_my_lesson_forecast() from public, anon;
grant execute on function public.get_my_lesson_forecast() to authenticated, service_role;

notify pgrst, 'reload schema';
