-- Stage 6D postconditions: execute as postgres, only in disposable Supabase CLI.
do $teacher_v2_6d_assertions$
declare
  current_membership uuid;
  due_membership uuid;
  current_day date;
  due_day date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  due_start timestamptz := ((due_day + time '13:00') at time zone 'America/Sao_Paulo');
begin
  select membership.id,
         ((now() at time zone 'America/Sao_Paulo') - interval '15 minutes')::date
    into current_membership, current_day
  from public.class_students membership
  where membership.class_number = 970006
    and membership.user_id='99000000-0000-4000-8000-000000000006';

  select id into due_membership
  from public.class_students
  where class_number = 970007
    and user_id='99000000-0000-4000-8000-000000000007';

  if current_membership is null or due_membership is null then
    raise exception 'Stage 6D: missing fixture memberships';
  end if;

  if (select count(*) from private.conversation_question_practice_log
      where student_id='99000000-0000-4000-8000-000000000006'
        and question_id='97000000-0000-4000-8000-000000000016') <> 1 then
    raise exception 'Stage 6D: two writers produced missing or duplicate ratings';
  end if;

  if not exists (
    select 1 from private.conversation_question_practice_log
    where student_id='99000000-0000-4000-8000-000000000006'
      and question_id='97000000-0000-4000-8000-000000000016'
      and rating='good'
  ) then
    raise exception 'Stage 6D: second writer overwrote the first rating';
  end if;

  if not exists (
    select 1 from private.academic_lesson_occurrences
    where occurrence_key = private.academic_occurrence_key(
      'regular', current_membership, current_day)
      and attendance_status='present'
  ) then
    raise exception 'Stage 6D: concurrent writing lost attendance';
  end if;

  if exists (
    select 1 from private.academic_class_session_finalizations
    where class_number=970006
  ) then
    raise exception 'Stage 6D: current lesson was prematurely finalized';
  end if;

  if (select count(*) from private.academic_class_session_finalizations
      where class_number=970007 and starts_at=due_start) <> 1 then
    raise exception 'Stage 6D: worker did not finalize due session exactly once';
  end if;

  if (select count(*) from private.academic_v2_closed_session_snapshots
      where class_number=970007 and starts_at=due_start) <> 1 then
    raise exception 'Stage 6D: due session snapshot was duplicated or lost';
  end if;

  if not exists (
    select 1 from private.academic_lesson_occurrences
    where occurrence_key=private.academic_occurrence_key(
      'regular', due_membership, due_day)
      and attendance_status='absent'
  ) then
    raise exception 'Stage 6D: missing attendance classification for due class';
  end if;

  if (select count(*) from private.academic_v2_attendance_audit
      where class_number=970007 and action='automatic_absence') <> 1 then
    raise exception 'Stage 6D: automatic absence audit was lost or duplicated';
  end if;

  if (select count(*) from private.academic_class_session_finalizations
      where class_number in (970006,970007)) <> 1 then
    raise exception 'Stage 6D: unexpected class finalization';
  end if;

  if not exists (
    select 1 from private.academic_v2_automation_control
    where singleton is true and enabled is false and enabled_from is null
  ) then
    raise exception 'Stage 6D: disabled state was not restored';
  end if;
end;
$teacher_v2_6d_assertions$;

select 'TEACHER_V2_STAGE6D_REAL_CONCURRENCY_PASSED' as result;
