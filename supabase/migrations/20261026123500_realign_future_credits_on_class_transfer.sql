-- Preserve contractual purchase history while retiming only unmodified future lessons
-- when a student changes classes. Works whether the old link is removed first
-- or a replacement link was added before removing the old one.
CREATE OR REPLACE FUNCTION private.realign_future_contract_credits(
  target_student_id uuid,
  target_class_number integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_weekday smallint;
  target_start_time time without time zone;
  target_class_name text;
  target_first_lesson date;
  target_linked_at timestamptz;
  first_candidate_day date;
  credits_to_move integer;
  credits_moved integer;
BEGIN
  IF target_student_id IS NULL OR target_class_number IS NULL THEN
    RETURN 0;
  END IF;

  -- Match payment synchronization's per-student serialization.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_student_id::text, 0)
  );

  SELECT
    class.class_weekday,
    class.class_start_time,
    class.class_name,
    greatest(
      membership.first_lesson_date,
      class.first_lesson_date
    ),
    membership.created_at
  INTO
    target_weekday,
    target_start_time,
    target_class_name,
    target_first_lesson,
    target_linked_at
  FROM public.class_students membership
  JOIN public.teacher_classes class
    ON class.class_number = membership.class_number
   AND class.is_active = true
  JOIN public.profiles student
    ON student.id = membership.user_id
   AND student.enrolled = true
   AND coalesce(student.archived, false) = false
  WHERE membership.user_id = target_student_id
    AND membership.class_number = target_class_number;

  IF NOT FOUND OR target_weekday NOT BETWEEN 1 AND 7
       OR target_start_time IS NULL THEN
    RETURN 0;
  END IF;

  first_candidate_day := greatest(
    (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::date,
    target_first_lesson
  );

  SELECT pg_catalog.count(*)::integer
  INTO credits_to_move
  FROM private.lesson_credits credit
  JOIN public.monthly_tuition tuition
    ON tuition.id = credit.tuition_id
   AND (tuition.payment_date IS NOT NULL OR tuition.is_exempt = true)
  WHERE credit.student_id = target_student_id
    AND credit.credit_origin = 'contract'
    AND credit.status = 'scheduled'
    AND credit.revoked_at IS NULL
    AND credit.cancelled_at IS NULL
    AND credit.makeup_booking_id IS NULL
    AND credit.regular_starts_at > pg_catalog.now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.class_students linked
      WHERE linked.user_id = target_student_id
        AND linked.class_number = credit.regular_class_number
    );

  IF credits_to_move = 0 THEN
    RETURN 0;
  END IF;

  WITH orphaned AS (
    SELECT
      credit.id,
      pg_catalog.row_number() OVER (
        ORDER BY tuition.due_date, credit.regular_starts_at,
                 credit.credit_number, credit.id
      ) AS position
    FROM private.lesson_credits credit
    JOIN public.monthly_tuition tuition
      ON tuition.id = credit.tuition_id
     AND (tuition.payment_date IS NOT NULL OR tuition.is_exempt = true)
    WHERE credit.student_id = target_student_id
      AND credit.credit_origin = 'contract'
      AND credit.status = 'scheduled'
      AND credit.revoked_at IS NULL
      AND credit.cancelled_at IS NULL
      AND credit.makeup_booking_id IS NULL
      AND credit.regular_starts_at > pg_catalog.now()
      AND NOT EXISTS (
        SELECT 1 FROM public.class_students linked
        WHERE linked.user_id = target_student_id
          AND linked.class_number = credit.regular_class_number
      )
  ),
  candidates AS (
    SELECT
      scheduled.starts_at,
      scheduled.starts_at + INTERVAL '1 hour' AS ends_at,
      pg_catalog.row_number() OVER (
        ORDER BY scheduled.starts_at
      ) AS position
    FROM (
      SELECT (
        lesson_day::date + target_start_time
      ) AT TIME ZONE 'America/Sao_Paulo' AS starts_at
      FROM pg_catalog.generate_series(
        first_candidate_day::timestamp,
        (first_candidate_day + 365)::timestamp,
        INTERVAL '1 day'
      ) AS lesson_day
      WHERE extract(isodow FROM lesson_day)::integer = target_weekday
    ) scheduled
    WHERE scheduled.starts_at > pg_catalog.now()
      AND (
        target_first_lesson IS NOT NULL
        OR scheduled.starts_at >= target_linked_at
      )
      AND NOT EXISTS (
        SELECT 1
        FROM private.lesson_credits reserved
        WHERE reserved.student_id = target_student_id
          AND reserved.credit_origin = 'contract'
          AND reserved.revoked_at IS NULL
          AND reserved.regular_class_number = target_class_number
          AND reserved.regular_starts_at = scheduled.starts_at
      )
      AND NOT EXISTS (
        SELECT 1
        FROM private.student_regular_lesson_cancellations cancellation
        WHERE cancellation.student_id = target_student_id
          AND cancellation.class_number = target_class_number
          AND cancellation.lesson_date =
            (scheduled.starts_at AT TIME ZONE 'America/Sao_Paulo')::date
      )
      AND NOT EXISTS (
        SELECT 1
        FROM private.lesson_credits other
        WHERE other.student_id = target_student_id
          AND other.credit_origin = 'contract'
          AND other.revoked_at IS NULL
          AND other.status IN ('scheduled', 'used')
          AND other.regular_starts_at = scheduled.starts_at
          AND other.regular_class_number <> target_class_number
          AND EXISTS (
            SELECT 1
            FROM public.class_students current_link
            WHERE current_link.user_id = target_student_id
              AND current_link.class_number = other.regular_class_number
          )
      )
  ),
  assignments AS (
    SELECT orphaned.id, candidates.starts_at, candidates.ends_at
    FROM orphaned
    JOIN candidates ON candidates.position = orphaned.position
  ),
  updated AS (
    UPDATE private.lesson_credits credit
    SET
      regular_class_number = target_class_number,
      regular_class_name = target_class_name,
      regular_starts_at = assignments.starts_at,
      regular_ends_at = assignments.ends_at
    FROM assignments
    WHERE credit.id = assignments.id
      -- Defensive recheck: preserve all modified or historical credits.
      AND credit.status = 'scheduled'
      AND credit.revoked_at IS NULL
      AND credit.cancelled_at IS NULL
      AND credit.makeup_booking_id IS NULL
      AND credit.regular_starts_at > pg_catalog.now()
    RETURNING credit.id
  )
  SELECT pg_catalog.count(*)::integer INTO credits_moved FROM updated;

  IF credits_moved <> credits_to_move THEN
    RAISE EXCEPTION
      'Cannot safely move all future contract credits: moved % of %',
      credits_moved, credits_to_move;
  END IF;

  RETURN credits_moved;
END;
$function$;

REVOKE ALL ON FUNCTION private.realign_future_contract_credits(uuid, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.realign_credits_on_class_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF new.user_id IS NOT NULL THEN
    PERFORM private.realign_future_contract_credits(
      new.user_id, new.class_number
    );
  END IF;
  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION private.realign_credits_on_class_link()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS realign_future_credits_on_class_link
  ON public.class_students;
CREATE TRIGGER realign_future_credits_on_class_link
AFTER INSERT OR UPDATE OF class_number, user_id
ON public.class_students
FOR EACH ROW
WHEN (new.user_id IS NOT NULL)
EXECUTE FUNCTION private.realign_credits_on_class_link();

-- Supports the opposite order (link new class, then remove old class).
-- Only a single remaining, more recently linked class is an unambiguous
-- destination; removing a class is not otherwise interpreted as a transfer.
CREATE OR REPLACE FUNCTION private.realign_credits_after_old_class_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  remaining_count integer;
  destination_class integer;
BEGIN
  IF old.user_id IS NULL THEN
    RETURN old;
  END IF;

  SELECT pg_catalog.count(*)::integer, pg_catalog.min(linked.class_number)
  INTO remaining_count, destination_class
  FROM public.class_students linked
  WHERE linked.user_id = old.user_id
    AND linked.created_at > old.created_at;

  IF remaining_count = 1 AND (
    SELECT pg_catalog.count(*)
    FROM public.class_students linked
    WHERE linked.user_id = old.user_id
  ) = 1 THEN
    PERFORM private.realign_future_contract_credits(
      old.user_id, destination_class
    );
  END IF;

  RETURN old;
END;
$function$;

REVOKE ALL ON FUNCTION private.realign_credits_after_old_class_removed()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS realign_future_credits_after_old_class_removed
  ON public.class_students;
CREATE TRIGGER realign_future_credits_after_old_class_removed
AFTER DELETE ON public.class_students
FOR EACH ROW
WHEN (old.user_id IS NOT NULL)
EXECUTE FUNCTION private.realign_credits_after_old_class_removed();
