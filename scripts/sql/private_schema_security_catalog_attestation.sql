-- Read-only attestation for the November 2026 private-schema security hardening.
-- This intentionally inspects grants and catalog state only, not student data.
with required_tables(table_name) as (
  values
    ('academic_class_session_finalizations'),
    ('academic_lesson_occurrences'),
    ('academic_non_instructional_class_dates'),
    ('administrative_weekly_plans'),
    ('auth_account_health_runs'),
    ('billing_plans'),
    ('conversation_question_practice_log'),
    ('lesson_credits'),
    ('mercado_pago_tuition_allocations'),
    ('operational_data_quality_runs'),
    ('payment_creation_control'),
    ('payment_creation_control_events'),
    ('payment_financial_health_runs'),
    ('student_lesson_preparations'),
    ('student_policy_acceptances'),
    ('student_question_studies'),
    ('student_regular_lesson_restorations'),
    ('system_health_alerts'),
    ('system_health_monitor_config'),
    ('system_health_runs'),
    ('system_synthetic_probe_results'),
    ('teacher_administrative_enrollment_drafts'),
    ('web_push_configuration'),
    ('web_push_notification_deliveries'),
    ('web_push_subscriptions')
)
select (
  (select count(*) from required_tables) = 25
  and (
    select count(*)
    from required_tables required
    join pg_catalog.pg_tables actual
      on actual.schemaname = 'private'
     and actual.tablename = required.table_name
     and actual.rowsecurity
  ) = 25
  and not exists (
    select 1 from pg_catalog.pg_tables
    where schemaname = 'private' and not rowsecurity
  )
  and not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname = 'private'
      and (
        has_function_privilege('anon', routine.oid, 'EXECUTE')
        or has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      )
  )
) as private_schema_security_attested;
