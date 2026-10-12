-- Preserve unknown historical pause dates and avoid retroactive billing after an exemption ends.
DO $patch$
DECLARE current_definition text; updated_definition text;
BEGIN
  SELECT pg_get_functiondef('public.set_teacher_student_course_state(uuid,text,text,text,date)'::regprocedure)
    INTO current_definition;
  updated_definition := replace(current_definition,
    '  was_paused boolean;',
    '  was_paused boolean;' || E'\n' ||
    '  was_exempt boolean;' || E'\n' ||
    '  previous_status_since date;' || E'\n' ||
    '  previous_billing_block_month date;');
  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Missing RPC variable anchor.';
  END IF;
  current_definition := updated_definition;

  updated_definition := replace(current_definition,
    $old$  SELECT COALESCE(target_billing_exemption, s.billing_exemption, 'none'),
         COALESCE(s.course_status = 'paused',false)
  INTO exemption_value, was_paused$old$,
    $new$  SELECT COALESCE(target_billing_exemption, s.billing_exemption, 'none'),
         COALESCE(s.course_status = 'paused',false),
         COALESCE(s.billing_exemption = 'permanent',false),
         s.status_since, s.billing_block_from_month
  INTO exemption_value, was_paused, was_exempt,
       previous_status_since, previous_billing_block_month$new$);
  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Missing RPC read anchor.';
  END IF;
  current_definition := updated_definition;

  updated_definition := replace(current_definition,
    $old$    COALESCE(target_effective_date,today_local), NULLIF(trim(target_reason),''),$old$,
    $new$    CASE
      WHEN target_effective_date IS NOT NULL THEN target_effective_date
      WHEN was_paused AND target_course_status='paused' THEN previous_status_since
      ELSE today_local
    END, NULLIF(trim(target_reason),''),$new$);
  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Missing status date anchor.';
  END IF;
  current_definition := updated_definition;

  updated_definition := replace(current_definition,
    $old$    CASE WHEN target_course_status='paused'
      THEN date_trunc('month',COALESCE(target_effective_date,today_local))::date ELSE NULL END,$old$,
    $new$    CASE WHEN target_course_status='paused' THEN
      COALESCE(
        date_trunc('month',target_effective_date)::date,
        CASE WHEN was_paused THEN previous_billing_block_month ELSE NULL END,
        date_trunc('month',today_local)::date
      ) ELSE NULL END,$new$);
  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Missing paused competence anchor.';
  END IF;
  current_definition := updated_definition;

  updated_definition := replace(current_definition,
    '    IF was_paused THEN',
    '    IF was_paused OR was_exempt THEN');
  IF updated_definition = current_definition THEN
    RAISE EXCEPTION 'Missing resume billing anchor.';
  END IF;

  EXECUTE updated_definition;
END;
$patch$;