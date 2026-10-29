-- Keep migration history immutable; disambiguate the authenticated student identifier.
CREATE OR REPLACE FUNCTION public.cancel_my_unpaid_lesson(
  target_class_number integer,
  target_starts_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cancellation_time timestamptz := now();
  grants_replacement boolean;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Faça login para cancelar esta aula.' USING errcode = '42501';
  END IF;

  -- Serialize against payment and credit allocation for this student.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = caller_id
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
    WHERE cancellation.student_id = caller_id
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
    caller_id, target_class_number, target_starts_at,
    cancellation_time, grants_replacement
  );

  -- The same cancellation ledger also suppresses future class attendance.
  INSERT INTO private.student_regular_lesson_cancellations (
    student_id, class_number, lesson_date, cancelled_by
  ) VALUES (
    caller_id, target_class_number,
    (target_starts_at at time zone 'America/Sao_Paulo')::date,
    caller_id
  ) ON CONFLICT (student_id, class_number, lesson_date) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'credit_granted', false,
    'eligible_after_payment', grants_replacement
  );
END;
$function$;

