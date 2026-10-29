-- A non-financial two-lesson preview; cancellations never mint free credits.
CREATE TABLE IF NOT EXISTS private.unpaid_lesson_cancellations (
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_number integer NOT NULL,
  starts_at timestamptz NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  eligible_for_replacement boolean NOT NULL,
  PRIMARY KEY (student_id, class_number, starts_at)
);
ALTER TABLE private.unpaid_lesson_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.unpaid_lesson_cancellations FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE private.unpaid_lesson_cancellations IS
  'Advance cancellations of unpaid forecast lessons, reconciled only after a qualifying tuition is settled.';

-- The already existing forecast is the single source of truth for the two
-- actionable dates. It returns no financial credit identifiers.
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
  last_paid_lesson_date date;
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

  -- Only real purchased dates anchor the preview; a paid invoice's coverage
  -- period must not hide unpaid dates between the fourth lesson and renewal.
  select max((credit.regular_starts_at at time zone 'America/Sao_Paulo')::date)
    into last_paid_lesson_date
  from private.lesson_credits credit
  join public.monthly_tuition tuition
    on tuition.id = credit.tuition_id
   and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false))
  where credit.student_id = caller_id
    and credit.credit_origin = 'contract'
    and credit.revoked_at is null
    and credit.regular_starts_at is not null;

  active_tuition_id := private.get_active_settled_tuition_id(caller_id, local_today);
  if last_paid_lesson_date is not null then
    preview_limit := 2;
    projection_start := greatest(local_today, last_paid_lesson_date + 1);
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

  -- Generate two future dates beyond purchased lessons; these do not
  -- create contractual credits, meeting access or attendance rights.
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
          'status', case
            when exists (
              select 1 from private.unpaid_lesson_cancellations cancellation
              where cancellation.student_id = caller_id
                and cancellation.class_number = candidate.class_number
                and cancellation.starts_at = candidate.starts_at
            ) then 'cancelled_pending'
            else 'predicted'
          end,
          'can_cancel', last_paid_lesson_date is not null
            and not exists (
              select 1 from private.student_regular_lesson_cancellations existing
              where existing.student_id = caller_id
                and existing.class_number = candidate.class_number
                and existing.lesson_date = candidate.lesson_date
            ),
          'cancellation_deadline', candidate.starts_at - interval '12 hours'
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

REVOKE ALL ON FUNCTION public.get_my_lesson_forecast() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_lesson_forecast() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_my_unpaid_lesson(
  target_class_number integer,
  target_starts_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  student_id uuid := auth.uid();
  cancellation_time timestamptz := now();
  grants_replacement boolean;
BEGIN
  IF student_id IS NULL THEN
    RAISE EXCEPTION 'Faça login para cancelar esta aula.' USING errcode = '42501';
  END IF;

  -- Serialize against payment and credit allocation for this student.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(student_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = student_id
      AND profile.enrolled = true
      AND coalesce(profile.archived, false) = false
  ) THEN
    RAISE EXCEPTION 'Sua matrícula não está ativa.';
  END IF;

  IF target_starts_at IS NULL OR target_starts_at <= cancellation_time THEN
    RAISE EXCEPTION 'Esta aula já começou e não pode mais ser cancelada.';
  END IF;

  -- Verify the exact two forecast slots, rather than accepting arbitrary
  -- timestamps supplied by the browser.
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      coalesce(public.get_my_lesson_forecast()->'predicted_lessons', '[]'::jsonb)
    ) AS preview(lesson)
    WHERE (preview.lesson->>'class_number')::integer = target_class_number
      AND (preview.lesson->>'starts_at')::timestamptz = target_starts_at
      AND preview.lesson->>'status' = 'predicted'
      AND (preview.lesson->>'can_cancel')::boolean = true
  ) THEN
    RAISE EXCEPTION 'Esta aula não está disponível para cancelamento antecipado.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.student_regular_lesson_cancellations cancellation
    WHERE cancellation.student_id = student_id
      AND cancellation.class_number = target_class_number
      AND cancellation.lesson_date =
        (target_starts_at at time zone 'America/Sao_Paulo')::date
  ) THEN
    RAISE EXCEPTION 'Esta aula já foi cancelada.';
  END IF;

  grants_replacement := private.lesson_cancellation_grants_credit(
    target_starts_at, cancellation_time
  );

  INSERT INTO private.unpaid_lesson_cancellations (
    student_id, class_number, starts_at, cancelled_at, eligible_for_replacement
  ) VALUES (
    student_id, target_class_number, target_starts_at,
    cancellation_time, grants_replacement
  );

  -- The same cancellation ledger also suppresses future class attendance.
  INSERT INTO private.student_regular_lesson_cancellations (
    student_id, class_number, lesson_date, cancelled_by
  ) VALUES (
    student_id, target_class_number,
    (target_starts_at at time zone 'America/Sao_Paulo')::date,
    student_id
  ) ON CONFLICT (student_id, class_number, lesson_date) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'credit_granted', false,
    'eligible_after_payment', grants_replacement
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_my_unpaid_lesson(integer, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_unpaid_lesson(integer, timestamptz)
  TO authenticated, service_role;

-- A later financial settlement converts the corresponding contractual
-- credit to "available" only when a qualifying advance cancellation exists.
-- A late cancellation consumes that paid slot without a replacement.
CREATE OR REPLACE FUNCTION private.reconcile_unpaid_lesson_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  cancellation private.unpaid_lesson_cancellations%ROWTYPE;
BEGIN
  IF NEW.credit_origin IS DISTINCT FROM 'contract'
     OR NEW.status IS DISTINCT FROM 'scheduled'
     OR NEW.regular_starts_at IS NULL
     OR NEW.revoked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.monthly_tuition tuition
    WHERE tuition.id = NEW.tuition_id
      AND (tuition.payment_date IS NOT NULL OR coalesce(tuition.is_exempt, false))
  ) THEN
    RETURN NEW;
  END IF;

  SELECT record.* INTO cancellation
  FROM private.unpaid_lesson_cancellations record
  WHERE record.student_id = NEW.student_id
    AND record.class_number = NEW.regular_class_number
    AND record.starts_at = NEW.regular_starts_at;

  IF FOUND THEN
    UPDATE private.lesson_credits credit
    SET status = CASE
        WHEN cancellation.eligible_for_replacement THEN 'available'
        ELSE 'forfeited'
      END,
      cancelled_at = cancellation.cancelled_at
    WHERE credit.id = NEW.id
      AND credit.status = 'scheduled'
      AND credit.revoked_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reconcile_unpaid_lesson_cancellation_on_credit
  ON private.lesson_credits;
CREATE TRIGGER reconcile_unpaid_lesson_cancellation_on_credit
AFTER INSERT OR UPDATE OF status, regular_starts_at ON private.lesson_credits
FOR EACH ROW EXECUTE FUNCTION private.reconcile_unpaid_lesson_cancellation();
