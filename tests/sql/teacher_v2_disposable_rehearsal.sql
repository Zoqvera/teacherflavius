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

-- The canonical disposable baseline is intentionally older than some
-- additive production schema details. Align only the tested nullable fields
-- inside the surrounding ROLLBACK, never on the operational Supabase project.
alter table public.teacher_classes
  add column if not exists first_lesson_date date;
alter table public.class_students
  add column if not exists first_lesson_date date;

-- Synthetic worker test. Deliberately does not call outgoing-email APIs.
-- The outer transaction is rolled back by CI, including Auth and lesson rows.
do $teacher_v2_synthetic_setup$
declare
  class_date date := ((now() at time zone 'America/Sao_Paulo')::date - 1);
  student_id uuid;
  membership_id uuid;
  class_start timestamptz :=
    ((((now() at time zone 'America/Sao_Paulo')::date - 1) + time '13:00')
    at time zone 'America/Sao_Paulo');
begin
  insert into public.teacher_classes (
    class_number, class_name, class_type, class_weekday,
    class_start_time, first_lesson_date
  ) values (
    970003, 'TURMA SINTETICA V2', 'QUINTETO',
    extract(isodow from class_date)::smallint,
    time '13:00', class_date
  );

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000'::uuid,
    ('99000000-0000-4000-8000-00000000000' || index_value)::uuid,
    'authenticated', 'authenticated',
    'teacher-v2-synthetic-' || index_value || '@invalid.test',
    '', now(), now(), now()
  from generate_series(1, 3) as index_value;

  insert into public.profiles (
    id, name, email, enrolled, archived,
    class_type, tuition_first_due_date
  )
  select
    ('99000000-0000-4000-8000-00000000000' || index_value)::uuid,
    'ALUNO TESTE V2 ' || index_value,
    'teacher-v2-synthetic-' || index_value || '@invalid.test',
    true, false, 'QUINTETO', class_date
  from generate_series(1, 3) as index_value
  on conflict (id) do update
  set name = excluded.name,
      enrolled = excluded.enrolled,
      archived = excluded.archived,
      class_type = excluded.class_type,
      tuition_first_due_date = excluded.tuition_first_due_date;

  -- The production enrollment trigger intentionally moves a newly linked
  -- student into the future. In this isolated historical-session fixture,
  -- disable ONLY that date-assignment trigger and restore it immediately.
  alter table public.class_students
    disable trigger assign_first_lesson_after_membership_trigger;

  insert into public.class_students (
    class_number, user_id, first_lesson_date
  )
  select
    970003,
    ('99000000-0000-4000-8000-00000000000' || index_value)::uuid,
    class_date
  from generate_series(1, 3) as index_value;

  alter table public.class_students
    enable trigger assign_first_lesson_after_membership_trigger;

  -- Student 1 previously participated. No other action is required.
  student_id := '99000000-0000-4000-8000-000000000001'::uuid;
  select id into membership_id from public.class_students
  where user_id = student_id and class_number = 970003;
  insert into private.academic_lesson_occurrences (
    occurrence_key, student_id, lesson_kind, source_entry_id,
    class_number, class_name, starts_at,
    attendance_status, presented_lesson_number
  ) values (
    private.academic_occurrence_key('regular', membership_id, class_date),
    student_id, 'regular', membership_id,
    970003, 'TURMA SINTETICA V2', class_start, 'present', 1
  );

  -- Student 3 cancelled. Cancellation must not be turned into absence.
  insert into private.student_regular_lesson_cancellations (
    student_id, class_number, lesson_date
  ) values (
    '99000000-0000-4000-8000-000000000003'::uuid,
    970003, class_date
  );

  update private.academic_v2_automation_control
  set enabled = true, enabled_from = class_start - interval '1 minute'
  where singleton = true;
end;
$teacher_v2_synthetic_setup$;

do $teacher_v2_worker_closure$
declare
  count_closed integer;
  count_again integer;
  class_date date := ((now() at time zone 'America/Sao_Paulo')::date - 1);
  class_start timestamptz :=
    ((((now() at time zone 'America/Sao_Paulo')::date - 1) + time '13:00')
    at time zone 'America/Sao_Paulo');
  roster jsonb;
begin
  select private.run_teacher_v2_auto_finalizations() into count_closed;
  if count_closed <> 1 then
    raise exception 'Roteiro v2: expected exactly one synthetic closure, got %', count_closed;
  end if;

  select private.run_teacher_v2_auto_finalizations() into count_again;
  if count_again <> 0 then
    raise exception 'Roteiro v2: repeated worker run is not idempotent';
  end if;

  select students into roster
  from private.academic_v2_closed_session_snapshots
  where class_number = 970003 and starts_at = class_start;

  if roster is null or jsonb_array_length(roster) <> 3 then
    raise exception 'Roteiro v2: cancelled student disappeared from snapshot';
  end if;
  if (select count(*)
      from private.academic_lesson_occurrences occurrence
      where occurrence.class_number = 970003
        and occurrence.attendance_status = 'present') <> 1 then
    raise exception 'Roteiro v2: existing presence must be preserved';
  end if;
  if (select count(*)
      from private.academic_lesson_occurrences occurrence
      where occurrence.class_number = 970003
        and occurrence.attendance_status = 'absent') <> 1 then
    raise exception 'Roteiro v2: student without participation must be absent';
  end if;

  if exists (
    select 1 from private.academic_lesson_occurrences occurrence
    where occurrence.student_id =
      '99000000-0000-4000-8000-000000000003'::uuid
      and occurrence.starts_at = class_start
  ) then
    raise exception 'Roteiro v2: cancelled student received attendance';
  end if;

  if (select count(*) from private.academic_v2_attendance_audit
      where class_number = 970003 and action = 'automatic_absence') <> 1 then
    raise exception 'Roteiro v2: absence audit was missing or duplicated';
  end if;
  if not exists (
    select 1 from private.academic_class_session_finalizations
    where class_number = 970003 and starts_at = class_start
  ) then
    raise exception 'Roteiro v2: finalized class not persisted';
  end if;
end;
$teacher_v2_worker_closure$;

select 'TEACHER_V2_DISPOSABLE_REHEARSAL_PASSED' as result;
