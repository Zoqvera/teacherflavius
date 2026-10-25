-- Stage 7C: read-only production preflight for teacher lesson v2.
-- Does not change schema, cron jobs, attendance, lesson history or payments.
-- Run as an authorized database administrator before requesting activation.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

DO $teacher_v2_stage7c_preflight$
DECLARE
  versions_count integer;
  latest_version text;
  installed_v2_migrations integer;
  control_rows integer;
  worker_jobs integer;
  protected_tables integer;
BEGIN
  SELECT count(*), max(version)
  INTO versions_count, latest_version
  FROM supabase_migrations.schema_migrations;

  IF versions_count <> 358 OR latest_version <> '20261023150740' THEN
    RAISE EXCEPTION 'Stage 7C: migration ledger changed; reconcile before release';
  END IF;

  SELECT count(*) INTO installed_v2_migrations
  FROM supabase_migrations.schema_migrations
  WHERE (version, name) IN (
    ('20261022202000', 'teacher_question_ratings_v2'),
    ('20261022212500', 'academic_v2_auto_attendance_and_closure'),
    ('20261022214500', 'academic_v2_private_table_rls'),
    ('20261022220000', 'academic_v2_shared_closure_lock'),
    ('20261022234500', 'fix_teacher_v2_closure_day_alias')
  )
    AND cardinality(statements) = 1
    AND length(statements[1]) > 200;

  IF installed_v2_migrations <> 5 THEN
    RAISE EXCEPTION 'Stage 7C: expected five canonical v2 migrations';
  END IF;

  IF to_regprocedure('public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)') IS NULL
     OR to_regprocedure('public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)') IS NULL
     OR to_regprocedure('public.mark_teacher_v2_participation(text,uuid,date)') IS NULL
     OR to_regprocedure('public.correct_teacher_v2_attendance(text,uuid,date,text,text)') IS NULL
     OR to_regprocedure('public.get_teacher_v2_closed_sessions(date)') IS NULL
     OR to_regprocedure('private.run_teacher_v2_auto_finalizations()') IS NULL THEN
    RAISE EXCEPTION 'Stage 7C: expected v2 RPCs are not installed';
  END IF;

  SELECT count(*) INTO protected_tables
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'private'
    AND c.relname IN (
      'academic_v2_automation_control',
      'academic_v2_closed_session_snapshots',
      'academic_v2_attendance_audit'
    )
    AND c.relrowsecurity = true;

  IF protected_tables <> 3 THEN
    RAISE EXCEPTION 'Stage 7C: v2 private RLS protection missing';
  END IF;

  IF has_function_privilege('anon',
       'public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.correct_teacher_v2_attendance(text,uuid,date,text,text)', 'EXECUTE')
     OR has_table_privilege('authenticated',
       'private.academic_v2_attendance_audit', 'SELECT') THEN
    RAISE EXCEPTION 'Stage 7C: administrative data is exposed to browser roles';
  END IF;

  SELECT count(*) INTO worker_jobs
  FROM cron.job
  WHERE jobname = 'teacher-v2-auto-finalize'
    AND schedule = '* * * * *'
    AND command = 'select private.run_teacher_v2_auto_finalizations();';

  IF worker_jobs <> 1 THEN
    RAISE EXCEPTION 'Stage 7C: expected one guarded finalization job';
  END IF;

  SELECT count(*) INTO control_rows
  FROM private.academic_v2_automation_control
  WHERE singleton = true AND enabled = false AND enabled_from IS NULL;

  IF control_rows <> 1 THEN
    RAISE EXCEPTION 'Stage 7C: server automation must be disabled for preflight';
  END IF;

  IF EXISTS (SELECT 1 FROM private.academic_v2_closed_session_snapshots)
     OR EXISTS (SELECT 1 FROM private.academic_v2_attendance_audit) THEN
    RAISE EXCEPTION 'Stage 7C: v2 already has recorded activity; review before first activation';
  END IF;
END;
$teacher_v2_stage7c_preflight$;

SELECT
  'TEACHER_V2_STAGE7C_READ_ONLY_PREFLIGHT_PASSED' AS status,
  (now() AT TIME ZONE 'America/Sao_Paulo') AS verified_local_time,
  (SELECT count(*) FROM supabase_migrations.schema_migrations) AS migration_count,
  (SELECT enabled FROM private.academic_v2_automation_control WHERE singleton = true)
    AS automation_enabled;

COMMIT;
