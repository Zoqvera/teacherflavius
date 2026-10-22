-- Executes ONLY inside a disposable Supabase CLI instance, wrapped in
-- BEGIN/ROLLBACK by the workflow. No real student data or paid integrations.
do $teacher_v2_release_rehearsal$
declare
  closed_count integer;
begin
  if to_regprocedure('public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)') is null
    or to_regprocedure('public.get_teacher_question_rating_history_v2(date)') is null
    or to_regprocedure('public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)') is null
    or to_regprocedure('public.mark_teacher_v2_participation(text,uuid,date)') is null
    or to_regprocedure('public.correct_teacher_v2_attendance(text,uuid,date,text,text)') is null
    or to_regprocedure('public.get_teacher_v2_closed_sessions(date)') is null
    or to_regprocedure('private.assert_teacher_v2_session_open(text,uuid,date)') is null
    or to_regprocedure('private.run_teacher_v2_auto_finalizations()') is null
  then
    raise exception 'Roteiro v2: one or more isolated RPCs were not installed';
  end if;

  if not exists (
    select 1 from private.academic_v2_automation_control control
    where singleton is true and enabled is false and enabled_from is null
  ) then
    raise exception 'Roteiro v2: automation control must default to disabled';
  end if;

  if not exists (
    select 1 from cron.job job
    where jobname = 'teacher-v2-auto-finalize' and schedule = '* * * * *'
  ) then
    raise exception 'Roteiro v2: expected a cron job with guarded worker';
  end if;

  select private.run_teacher_v2_auto_finalizations() into closed_count;
  if closed_count <> 0 then
    raise exception 'Roteiro v2: disabled worker closed % classes', closed_count;
  end if;

  if exists (
    select 1
    from pg_class relation
    join pg_namespace schema_name on schema_name.oid = relation.relnamespace
    where schema_name.nspname = 'private'
      and relation.relname in (
        'academic_v2_automation_control',
        'academic_v2_closed_session_snapshots',
        'academic_v2_attendance_audit'
      )
      and relation.relrowsecurity is false
  ) then
    raise exception 'Roteiro v2: private RLS is missing';
  end if;

  if has_function_privilege('anon',
        'public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)',
        'execute')
     or has_function_privilege('anon',
        'public.get_teacher_question_rating_history_v2(date)',
        'execute')
     or has_function_privilege('anon',
        'public.get_teacher_v2_closed_sessions(date)', 'execute')
     or has_function_privilege('anon',
        'public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)', 'execute')
  then
    raise exception 'Roteiro v2: anonymous role unexpectedly has administrative RPC access';
  end if;

  if not has_function_privilege('authenticated',
        'public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)',
        'execute')
     or not has_function_privilege('authenticated',
        'public.get_teacher_question_rating_history_v2(date)', 'execute')
  then
    raise exception 'Roteiro v2: teacher-authenticated RPC grants missing';
  end if;

  if has_table_privilege('authenticated',
        'private.academic_v2_automation_control', 'select')
     or has_table_privilege('anon',
        'private.academic_v2_attendance_audit', 'select')
  then
    raise exception 'Roteiro v2: private tables are accessible to browsers';
  end if;

  if exists (select 1 from private.academic_v2_closed_session_snapshots)
     or exists (select 1 from private.academic_v2_attendance_audit) then
    raise exception 'Roteiro v2: unexpectedly modified attendance in rehearsal';
  end if;
end;
$teacher_v2_release_rehearsal$;

-- Even a direct call with a nonexistent administrative identity fails closed.
do $teacher_v2_unauthenticated$
begin
  begin
    perform public.get_teacher_v2_closed_sessions(date '2026-10-22');
    raise exception 'Roteiro v2: history exposed without teacher authentication';
  exception
    when sqlstate '42501' then null;
  end;
  begin
    perform public.mark_teacher_v2_participation(
      'regular',
      '11111111-1111-4111-8111-111111111111'::uuid,
      date '2026-10-22'
    );
    raise exception 'Roteiro v2: participation without teacher authentication';
  exception
    when sqlstate '42501' then null;
  end;
end;
$teacher_v2_unauthenticated$;

select 'TEACHER_V2_DISPOSABLE_REHEARSAL_PASSED' as result;
