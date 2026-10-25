-- Stage 6B: authenticated teacher/admin RPC integration.
-- Run only in the disposable Supabase CLI restore workflow, inside BEGIN/ROLLBACK.
-- The stage 6A fixture must have finalized class 970003 first.
-- No real users, charges, attendance, or live cron jobs are touched.

do $teacher_v2_admin_setup$
declare
  teacher_id constant uuid := '98000000-0000-4000-8000-000000000001';
begin
  if not exists (
    select 1 from private.academic_v2_closed_session_snapshots
    where class_number = 970003
  ) then
    raise exception 'Stage 6B requires the stage 6A disposable closure';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000'::uuid,
    teacher_id, 'authenticated', 'authenticated',
    'teacher-v2-fixture-admin@invalid.test', '', now(), now(), now()
  );

  insert into public.teacher_admins (user_id, email)
  values (teacher_id, 'teacher-v2-fixture-admin@invalid.test');
end;
$teacher_v2_admin_setup$;

-- Match the SQL role and JWT claims normally used by the Supabase Data API.
-- SECURITY DEFINER administrative RPCs must verify the caller identity.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '98000000-0000-4000-8000-000000000001',
    'email', 'teacher-v2-fixture-admin@invalid.test',
    'role', 'authenticated'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true
);
select set_config(
  'teacher_v2_fixture.membership',
  (select id::text from public.class_students
   where class_number = 970003
     and user_id = '99000000-0000-4000-8000-000000000002'::uuid),
  true
);
set local role authenticated;

do $teacher_v2_authenticated_teacher$
declare
  class_date date := ((now() at time zone 'America/Sao_Paulo')::date - 1);
  student_membership uuid;
  result jsonb;
  history_count integer;
  snapshot_status text;
begin
  if auth.uid() is distinct from '98000000-0000-4000-8000-000000000001'::uuid
     or not public.is_teacher_admin() then
    raise exception 'Stage 6B did not authenticate the synthetic professor';
  end if;

  student_membership := current_setting('teacher_v2_fixture.membership')::uuid;

  select count(*) into history_count
  from public.get_teacher_v2_closed_sessions(class_date)
  where class_number = 970003;
  if history_count <> 1 then
    raise exception 'Stage 6B: authorized closed-session history not visible';
  end if;

  begin
    perform public.correct_teacher_v2_attendance(
      'regular', student_membership, class_date, 'present', 'curto'
    );
    raise exception 'Stage 6B: too-short correction reason accepted';
  exception
    when sqlstate '22023' then null;
  end;

  result := public.correct_teacher_v2_attendance(
    'regular', student_membership, class_date, 'present',
    'Professor confirmou participação após revisão das evidências.'
  );
  if result->>'ok' <> 'true'
     or result->>'attendance_status' <> 'present'
     or result->>'unchanged' <> 'false' then
    raise exception 'Stage 6B: correction was not acknowledged';
  end if;

  result := public.correct_teacher_v2_attendance(
    'regular', student_membership, class_date, 'present',
    'Repetição da correção para testar idempotência.'
  );
  if result->>'unchanged' <> 'true' then
    raise exception 'Stage 6B: repeated correction was not idempotent';
  end if;

  select student_row->>'attendance_status' into snapshot_status
  from public.get_teacher_v2_closed_sessions(class_date) closed
  cross join lateral jsonb_array_elements(closed.students) student_row
  where closed.class_number = 970003
    and student_row->>'student_id' =
        '99000000-0000-4000-8000-000000000002';
  if snapshot_status <> 'present' then
    raise exception 'Stage 6B: closed-session view did not reflect corrected attendance';
  end if;

  begin
    perform public.mark_teacher_lesson_presented_v2(
      'regular', student_membership, class_date, 1
    );
    raise exception 'Stage 6B: writing presentation after closure was accepted';
  exception
    when others then
      if sqlerrm like 'Stage 6B:%' or sqlstate = '42501' then
        raise;
      end if;
  end;

  begin
    perform public.rate_teacher_conversation_question_v2(
      'regular', student_membership, class_date,
      '11111111-1111-4111-8111-111111111111'::uuid, 'good'
    );
    raise exception 'Stage 6B: writing rating after closure was accepted';
  exception
    when others then
      if sqlerrm like 'Stage 6B:%' or sqlstate = '42501' then
        raise;
      end if;
  end;
end;
$teacher_v2_authenticated_teacher$;

-- Inspect private audit records only as the disposable test harness.
-- Public browser roles must remain unable to access private tables.
reset role;

do $teacher_v2_privileged_audit_check$
declare
  audit_count integer;
begin
  select count(*) into audit_count
  from private.academic_v2_attendance_audit
  where student_id = '99000000-0000-4000-8000-000000000002'::uuid
    and action = 'admin_correction'
    and new_status = 'present'
    and changed_by = '98000000-0000-4000-8000-000000000001'::uuid;
  if audit_count <> 1 then
    raise exception 'Stage 6B: correction audit is missing or duplicated';
  end if;

  if not exists (
    select 1 from private.academic_v2_closed_session_snapshots snapshots
    where snapshots.class_number = 970003
      and snapshots.students @>
        '[{"student_id":"99000000-0000-4000-8000-000000000002","attendance_status":"absent"}]'::jsonb
  ) then
    raise exception 'Stage 6B: closed-session audit snapshot was rewritten';
  end if;
end;
$teacher_v2_privileged_audit_check$;

set local role authenticated;

-- An authenticated student must not be able to read or change teacher data.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99000000-0000-4000-8000-000000000002',
    'email', 'teacher-v2-synthetic-2@invalid.test',
    'role', 'authenticated'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub', '99000000-0000-4000-8000-000000000002', true
);

do $teacher_v2_authenticated_student_denied$
declare
  class_date date := ((now() at time zone 'America/Sao_Paulo')::date - 1);
  student_membership uuid;
begin
  if auth.uid() is distinct from '99000000-0000-4000-8000-000000000002'::uuid
     or public.is_teacher_admin() then
    raise exception 'Stage 6B student fixture was incorrectly authorized';
  end if;

  begin
    perform public.get_teacher_v2_closed_sessions(class_date);
    raise exception 'Stage 6B: student read teacher-only closed sessions';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.get_teacher_question_rating_history_v2(class_date);
    raise exception 'Stage 6B: student read teacher-only question history';
  exception
    when sqlstate '42501' then null;
  end;

  student_membership := current_setting('teacher_v2_fixture.membership')::uuid;

  begin
    perform public.correct_teacher_v2_attendance(
      'regular', student_membership, class_date, 'absent',
      'Acesso não autorizado de teste.'
    );
    raise exception 'Stage 6B: student was allowed to correct attendance';
  exception
    when sqlstate '42501' then null;
  end;
end;
$teacher_v2_authenticated_student_denied$;

select 'TEACHER_V2_AUTH_ADMIN_REHEARSAL_PASSED' as result;
