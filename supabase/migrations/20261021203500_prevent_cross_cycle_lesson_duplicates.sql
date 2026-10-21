-- Contract lessons belong to the paid block of lessons, not exclusively
-- to the interval ending at the next invoice due date.
-- Keep the original tuition due dates, student credits, cancellation
-- behavior and security boundary; avoid reusing an earlier paid slot.
-- Historic allocated/cancelled/used credits are not bulk-repaired.
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
    when exists (
      select 1 from private.lesson_credit_revocation_justifications reason
      where reason.credit_id = credit.id
    ) then credit.revoked_at
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
    revoked_at = case
      when exists (
        select 1 from private.lesson_credit_revocation_justifications reason
        where reason.credit_id = private.lesson_credits.id
      ) then private.lesson_credits.revoked_at
      else null
    end,
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


CREATE OR REPLACE FUNCTION public.get_my_lesson_credits()
 RETURNS TABLE(credit_id uuid, reference_month date, credit_number smallint, status text, class_number integer, class_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, meeting_url text, original_class_number integer, original_class_name text, original_starts_at timestamp with time zone, cancellation_deadline timestamp with time zone, can_cancel boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        then private.lesson_can_be_cancelled(slot.starts_at, now())
      when credit.status = 'scheduled'
        then private.lesson_can_be_cancelled(credit.regular_starts_at, now())
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
      -- Keep paid future lessons visible after the financial cycle closes,
      -- including when the next tuition has already been paid.
      or (
        credit.status = 'scheduled'
        and credit.regular_starts_at > now()
        and exists (
          select 1
          from public.monthly_tuition paid_tuition
          where paid_tuition.id = credit.tuition_id
            and (paid_tuition.payment_date is not null
              or coalesce(paid_tuition.is_exempt, false))
        )
      )
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
$function$


CREATE OR REPLACE FUNCTION public.get_my_lesson_forecast()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- A lesson already purchased in a prior cycle must not reappear
      -- as an unpaid forecast in the following financial period.
      and not exists (
        select 1
        from private.lesson_credits paid_credit
        join public.monthly_tuition paid_tuition
          on paid_tuition.id = paid_credit.tuition_id
        where paid_credit.student_id = caller_id
          and paid_credit.credit_origin = 'contract'
          and paid_credit.revoked_at is null
          and paid_credit.status in ('scheduled', 'used')
          and paid_credit.regular_class_number = occurrence.class_number
          and paid_credit.regular_starts_at = occurrence.starts_at
          and (paid_tuition.payment_date is not null
            or coalesce(paid_tuition.is_exempt, false))
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
$function$

