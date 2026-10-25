-- Stage 7C emergency rollback: disable only the v2 automatic finalization.
-- Never delete, rewrite, or backdate attendance, payments or audit records.
-- Execute with a database administrator if the v2 release must be suspended.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Coordinate with in-flight teacher writes and the automatic finalizer.
SELECT pg_catalog.pg_advisory_xact_lock(20261022, 4);

DO $teacher_v2_stage7c_stop$
DECLARE
  affected integer;
BEGIN
  IF to_regclass('private.academic_v2_automation_control') IS NULL THEN
    RAISE EXCEPTION 'Stage 7C rollback: v2 automation control not installed';
  END IF;

  UPDATE private.academic_v2_automation_control
  SET enabled = false, enabled_from = NULL
  WHERE singleton = true;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Stage 7C rollback: expected exactly one control row, got %', affected;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.academic_v2_automation_control
    WHERE singleton = true AND enabled = false AND enabled_from IS NULL
  ) THEN
    RAISE EXCEPTION 'Stage 7C rollback: failed to disable the automatic worker';
  END IF;
END;
$teacher_v2_stage7c_stop$;

SELECT 'TEACHER_V2_STAGE7C_AUTOMATION_DISABLED' AS status;
COMMIT;
