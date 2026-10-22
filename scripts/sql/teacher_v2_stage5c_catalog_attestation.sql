-- Read-only attestation for five selectively installed Teacher v2 migrations.
-- Used only by the protected migration drift checker after the rollout.
select
  (select count(*) = 5 from supabase_migrations.schema_migrations
   where (version, name) in (
     ('20261022202000','teacher_question_ratings_v2'),
     ('20261022212500','academic_v2_auto_attendance_and_closure'),
     ('20261022214500','academic_v2_private_table_rls'),
     ('20261022220000','academic_v2_shared_closure_lock'),
     ('20261022234500','fix_teacher_v2_closure_day_alias')
   ))
  and to_regprocedure('public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)') is not null
  and to_regprocedure('public.get_teacher_question_rating_history_v2(date)') is not null
  and to_regprocedure('public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)') is not null
  and to_regprocedure('private.run_teacher_v2_auto_finalizations()') is not null
  and to_regclass('private.academic_v2_automation_control') is not null
  and exists (select 1 from cron.job where jobname = 'teacher-v2-auto-finalize')
  and not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname in (
      'academic_v2_automation_control',
      'academic_v2_closed_session_snapshots',
      'academic_v2_attendance_audit'
    ) and not c.relrowsecurity
  )
  and not has_function_privilege(
    'anon',
    'public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.get_teacher_v2_closed_sessions(date)',
    'execute'
  ) as teacher_v2_catalog_attested;
