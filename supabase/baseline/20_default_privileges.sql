-- Application-specific privileges for objects created by postgres in public.
-- Browser-facing access is granted explicitly and must stay aligned with RLS.
-- Supabase-managed default ACLs in auth/storage/extensions/etc. are intentionally not duplicated here.

-- New application tables and sequences must not become browser-accessible by default.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

-- 10_public_schema.sql is a historical schema capture whose ACL section predates
-- this least-privilege policy. Normalize existing baseline objects after that file runs.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Re-grant only the browser table operations intentionally present in production.
-- Statements are conditional because the baseline predates some current tables.
do $least_privilege$
declare
  item record;
begin
  for item in
    select * from (values
      ('activity_results', 'select, insert'),
      ('app_error_events', 'select'),
      ('class_lesson_records', 'select, insert, update, delete'),
      ('class_resources', 'select, insert, update, delete'),
      ('class_students', 'select'),
      ('daily_exercise_completion', 'select'),
      ('data_retention_policies', 'select'),
      ('data_retention_runs', 'select'),
      ('data_subject_requests', 'select'),
      ('enrollment_email_notifications', 'select'),
      ('exercise_sync_events', 'select'),
      ('exercise_sync_runs', 'select'),
      ('flashcard_decks', 'select, insert, update, delete'),
      ('flashcard_practice_days', 'select, insert'),
      ('flashcard_review_history', 'select, insert'),
      ('flashcard_srs', 'select, insert, update'),
      ('flashcards', 'select, insert, update, delete'),
      ('grammar_lesson_completion', 'select, insert, update'),
      ('grammar_lessons', 'select, insert, update, delete'),
      ('makeup_class_email_notifications', 'select'),
      ('natanael_acquisition_events', 'select'),
      ('natanael_admins', 'select'),
      ('page_content_overrides', 'select, insert, update'),
      ('profiles', 'select, insert, update'),
      ('pronunciation_assignments', 'select, insert, update, delete'),
      ('pronunciation_attempts', 'select, update'),
      ('student_access_logs', 'select'),
      ('student_billing_settings', 'select, insert, update, delete'),
      ('student_enrollment_invites', 'select, insert, update, delete'),
      ('student_enrollments', 'select'),
      ('student_frequency', 'select'),
      ('student_private_data', 'select, insert, update'),
      ('student_tags', 'select, insert, delete'),
      ('study_roadmap_completion', 'select, insert, update, delete'),
      ('teacher_classes', 'select, insert, update, delete'),
      ('teacher_exercises', 'select, insert, update, delete'),
      ('weekly_plan_snapshots', 'select'),
      ('weekly_student_tasks', 'select, insert, update, delete')
    ) as grants(table_name, privileges)
  loop
    if to_regclass(format('public.%I', item.table_name)) is not null then
      execute format(
        'grant %s on table public.%I to authenticated',
        item.privileges,
        item.table_name
      );
    end if;
  end loop;

  if to_regclass('public.page_content_overrides') is not null then
    grant select on table public.page_content_overrides to anon;
  end if;
end;
$least_privilege$;
