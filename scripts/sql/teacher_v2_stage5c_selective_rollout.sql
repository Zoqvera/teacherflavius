-- Roteiro da Aula v2: selective schema-only deployment.
-- Execute ONLY with psql --single-transaction --set=ON_ERROR_STOP=1.
-- No class history, student attendance, billing, or activation is modified.
set lock_timeout = '5s';
set statement_timeout = '90s';
select pg_advisory_xact_lock(hashtext('teacherflavius'), hashtext('roteiro-v2-5c'));
lock table supabase_migrations.schema_migrations in share row exclusive mode;

do $preflight$
declare
  versions_count integer;
  latest_version text;
begin
  select count(*), max(version) into versions_count, latest_version
  from supabase_migrations.schema_migrations;

  if versions_count <> 350 or latest_version <> '20261022205054' then
    raise exception 'Roteiro v2: production migration ledger changed. Abort.';
  end if;

  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version in (
      '20261022202000','20261022212500','20261022214500','20261022220000'
    )
  ) then
    raise exception 'Roteiro v2: partial migration ledger exists. Abort.';
  end if;

  if to_regprocedure('public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)') is not null
      or to_regprocedure('public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)') is not null
      or to_regprocedure('private.run_teacher_v2_auto_finalizations()') is not null
      or to_regclass('private.academic_v2_automation_control') is not null
      or exists (select 1 from cron.job where jobname='teacher-v2-auto-finalize') then
    raise exception 'Roteiro v2: objects partially deployed. Abort.';
  end if;

  if to_regprocedure('private.sync_academic_attendance(text,uuid,date,text)') is null
      or to_regprocedure('private.resolve_academic_lesson(text,uuid,date)') is null
      or to_regprocedure('public.rate_teacher_conversation_question(text,uuid,date,uuid,text)') is null
      or to_regprocedure('public.mark_teacher_lesson_presented(text,uuid,date,integer)') is null
      or to_regprocedure('public.get_teacher_lesson_plan(date)') is null
      or to_regclass('private.academic_lesson_occurrences') is null
      or to_regclass('private.academic_class_session_finalizations') is null
      or to_regclass('private.conversation_question_practice_log') is null
      or to_regclass('public.teacher_classes') is null
      or to_regclass('public.class_students') is null
      or to_regclass('public.profiles') is null then
    raise exception 'Roteiro v2: required production academic workflow missing. Abort.';
  end if;
end;
$preflight$;

-- The four immutable Git files may include a version that predates the
-- current ledger tip, but no migration is replayed or renumbered.
\ir ../../supabase/migrations/20261022202000_teacher_question_ratings_v2.sql
\ir ../../supabase/migrations/20261022212500_academic_v2_auto_attendance_and_closure.sql
\ir ../../supabase/migrations/20261022214500_academic_v2_private_table_rls.sql
\ir ../../supabase/migrations/20261022220000_academic_v2_shared_closure_lock.sql

-- Record only these four canonical identities with DDL in one transaction.
insert into supabase_migrations.schema_migrations(version,name) values
 ('20261022202000','teacher_question_ratings_v2'),
 ('20261022212500','academic_v2_auto_attendance_and_closure'),
 ('20261022214500','academic_v2_private_table_rls'),
 ('20261022220000','academic_v2_shared_closure_lock');

do $postflight$
declare
  job_count integer;
  inactive integer;
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 354 or
     (select max(version) from supabase_migrations.schema_migrations) <> '20261022220000' then
    raise exception 'Roteiro v2: unexpected migration ledger after DDL.';
  end if;

  if not exists (
    select 1 from private.academic_v2_automation_control
    where singleton=true and enabled=false and enabled_from is null
  ) then
    raise exception 'Roteiro v2: automation release gate not disabled.';
  end if;

  select count(*) into job_count from cron.job
  where jobname='teacher-v2-auto-finalize'
    and command='select private.run_teacher_v2_auto_finalizations();';
  if job_count <> 1 then
    raise exception 'Roteiro v2: missing or duplicate auto-closure job.';
  end if;

  if (select private.run_teacher_v2_auto_finalizations()) <> 0 then
    raise exception 'Roteiro v2: disabled cron worker modified real classes.';
  end if;

  if exists (select 1 from private.academic_v2_closed_session_snapshots)
    or exists (select 1 from private.academic_v2_attendance_audit) then
    raise exception 'Roteiro v2: new history/audit tables were not empty.';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in (
      'academic_v2_automation_control','academic_v2_closed_session_snapshots',
      'academic_v2_attendance_audit'
    ) and not c.relrowsecurity
  ) then
    raise exception 'Roteiro v2: RLS missing on private tables.';
  end if;

  if has_function_privilege('anon',
      'public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)','execute')
     or has_function_privilege('anon',
      'public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)','execute')
     or has_function_privilege('anon',
      'public.get_teacher_v2_closed_sessions(date)','execute')
     or has_function_privilege('anon',
      'public.correct_teacher_v2_attendance(text,uuid,date,text,text)','execute') then
    raise exception 'Roteiro v2: anonymous grants are unsafe.';
  end if;

  if not has_function_privilege('authenticated',
      'public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)','execute')
     or not has_function_privilege('authenticated',
      'public.get_teacher_v2_closed_sessions(date)','execute') then
    raise exception 'Roteiro v2: teacher RPC grants missing.';
  end if;
end;
$postflight$;

select 'TEACHER_V2_STAGE5C_SCHEMA_COMMITTED_WITH_GATES_DISABLED' as status;
