-- Etapa 6C: presentation and question evaluation inside a real time window.
-- Runs after 6A and 6B, in their SAME disposable BEGIN/ROLLBACK.
-- PostgreSQL fixture uses only synthetic Auth identities, class and questions.
reset role;

do $teacher_v2_6c_setup$
declare
  local_start timestamp := (now() at time zone 'America/Sao_Paulo') - interval '15 minutes';
  lesson_day date := local_start::date;
  class_time time := local_start::time;
  makeup_slot_id uuid := '97000000-0000-4000-8000-000000000011'::uuid;
  makeup_booking_id uuid := '97000000-0000-4000-8000-000000000012'::uuid;
begin
  insert into public.teacher_classes (
    class_number, class_name, class_type, class_weekday,
    class_start_time, first_lesson_date
  ) values (
    970004, 'TURMA V2 ENSAIO EM ANDAMENTO', 'quintet',
    extract(isodow from lesson_day)::smallint,
    class_time, lesson_day
  );

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000'::uuid,
    ('99000000-0000-4000-8000-00000000000' || n)::uuid,
    'authenticated', 'authenticated',
    'teacher-v2-6c-student-' || n || '@invalid.test',
    '', now(), now(), now()
  from generate_series(6, 8) n;

  insert into public.profiles (
    id, name, email, enrolled, archived, class_type, tuition_first_due_date
  )
  select
    ('99000000-0000-4000-8000-00000000000' || n)::uuid,
    'ALUNO TESTE V2 6C ' || n,
    'teacher-v2-6c-student-' || n || '@invalid.test',
    true, false, 'QUINTETO', lesson_day
  from generate_series(6, 8) n;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.class_students'::regclass
      and tgname = 'assign_first_lesson_after_membership_trigger'
  ) then
    alter table public.class_students
      disable trigger assign_first_lesson_after_membership_trigger;
  end if;

  insert into public.class_students(class_number, user_id, first_lesson_date)
  select 970004,
         ('99000000-0000-4000-8000-00000000000' || n)::uuid,
         lesson_day
  from generate_series(6, 7) n;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.class_students'::regclass
      and tgname = 'assign_first_lesson_after_membership_trigger'
  ) then
    alter table public.class_students
      enable trigger assign_first_lesson_after_membership_trigger;
  end if;

  insert into public.conversation_questions (
    id, question_text, display_order, question_translation, answer_examples
  ) values (
    '97000000-0000-4000-8000-000000000013'::uuid,
    'How was the synthetic class?', 999999,
    'Como foi a aula fictícia?',
    '["It was helpful.", "I practiced with my teacher."]'::jsonb
  );

  insert into private.student_question_studies (student_id, question_id)
  select
    ('99000000-0000-4000-8000-00000000000' || n)::uuid,
    '97000000-0000-4000-8000-000000000013'::uuid
  from generate_series(6, 8) n;

  insert into public.makeup_class_slots (
    id, starts_at, ends_at, capacity, is_active,
    class_number, class_name
  ) values (
    makeup_slot_id,
    local_start at time zone 'America/Sao_Paulo',
    (local_start + interval '90 minutes') at time zone 'America/Sao_Paulo',
    1, true, 970004, 'TURMA V2 ENSAIO EM ANDAMENTO'
  );

  insert into public.makeup_class_bookings (
    id, slot_id, student_id, class_number, class_name,
    student_name, student_email, meeting_url, status
  ) values (
    makeup_booking_id, makeup_slot_id,
    '99000000-0000-4000-8000-000000000008'::uuid,
    970004, 'TURMA V2 ENSAIO EM ANDAMENTO',
    'ALUNO TESTE V2 6C 8', 'teacher-v2-6c-student-8@invalid.test',
    'https://example.invalid/test', 'confirmed'
  );

  perform set_config('teacher_v2_6c.lesson_date',lesson_day::text,true);
  perform set_config(
    'teacher_v2_6c.student_present_entry',
    (select id::text from public.class_students
     where class_number = 970004
       and user_id='99000000-0000-4000-8000-000000000006'::uuid),true
  );
  perform set_config(
    'teacher_v2_6c.student_reject_entry',
    (select id::text from public.class_students
     where class_number = 970004
       and user_id='99000000-0000-4000-8000-000000000007'::uuid),true
  );
end;
$teacher_v2_6c_setup$;

-- Use a synthetic authenticated teacher; real students remain untouched.
select set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', '98000000-0000-4000-8000-000000000001',
    'email', 'teacher-v2-fixture-admin@invalid.test',
    'role', 'authenticated'
  )::text,true);
select set_config('request.jwt.claim.sub',
                  '98000000-0000-4000-8000-000000000001',true);
set local role authenticated;

do $teacher_v2_6c_live_rpcs$
declare
  lesson_date date := current_setting('teacher_v2_6c.lesson_date')::date;
  regular_entry uuid := current_setting('teacher_v2_6c.student_present_entry')::uuid;
  rejected_entry uuid := current_setting('teacher_v2_6c.student_reject_entry')::uuid;
  makeup_entry uuid := '97000000-0000-4000-8000-000000000012'::uuid;
  question_id uuid := '97000000-0000-4000-8000-000000000013'::uuid;
  result jsonb;
begin
  if not public.is_teacher_admin() then
    raise exception 'Stage 6C: teacher identity was not authorized';
  end if;

  result := public.mark_teacher_lesson_presented_v2(
    'regular',regular_entry,lesson_date,1
  );
  if result->>'ok' <> 'true' or result->>'lesson_number' <> '1' then
    raise exception 'Stage 6C: regular presentation not confirmed';
  end if;

  result := public.rate_teacher_conversation_question_v2(
    'regular',regular_entry,lesson_date,question_id,'good'
  );
  if result->>'ok' <> 'true' or result->>'rating' <> 'good'
     or result->>'already_rated' <> 'false' then
    raise exception 'Stage 6C: first valid question rating not confirmed';
  end if;

  -- Duplicate submission (second tab/retry) must reuse the initial rating.
  result := public.rate_teacher_conversation_question_v2(
    'regular',regular_entry,lesson_date,question_id,'improve'
  );
  if result->>'ok' <> 'true' or result->>'rating' <> 'good'
     or result->>'already_rated' <> 'true' then
    raise exception 'Stage 6C: duplicate question rating changed the result';
  end if;

  result := public.mark_teacher_lesson_presented_v2(
    'makeup',makeup_entry,lesson_date,1
  );
  if result->>'ok' <> 'true' or result->>'lesson_number' <> '1' then
    raise exception 'Stage 6C: makeup presentation was not recorded';
  end if;

  result := public.rate_teacher_conversation_question_v2(
    'makeup',makeup_entry,lesson_date,question_id,'medium'
  );
  if result->>'ok' <> 'true' or result->>'rating' <> 'medium' then
    raise exception 'Stage 6C: makeup question rating not recorded';
  end if;

  -- Invalid question must roll back its prior attendance write in the RPC.
  begin
    perform public.rate_teacher_conversation_question_v2(
      'regular',rejected_entry,lesson_date,
      '97000000-0000-4000-8000-000000000099'::uuid,'good'
    );
    raise exception 'Stage 6C: invalid question was accepted';
  exception
    when others then
      if sqlerrm like 'Stage 6C:%' or sqlstate='42501' then
        raise;
      end if;
  end;
end;
$teacher_v2_6c_live_rpcs$;

reset role;

do $teacher_v2_6c_verify_writes$
declare
  regular_entry uuid := current_setting('teacher_v2_6c.student_present_entry')::uuid;
  rejected_entry uuid := current_setting('teacher_v2_6c.student_reject_entry')::uuid;
  lesson_date date := current_setting('teacher_v2_6c.lesson_date')::date;
begin
  if (select count(*) from private.conversation_question_practice_log
      where question_id='97000000-0000-4000-8000-000000000013'::uuid
        and student_id='99000000-0000-4000-8000-000000000006'::uuid) <> 1 then
    raise exception 'Stage 6C: duplicate regular evaluations';
  end if;

  if (select count(*) from private.conversation_question_practice_log
      where question_id='97000000-0000-4000-8000-000000000013'::uuid
        and student_id='99000000-0000-4000-8000-000000000008'::uuid) <> 1 then
    raise exception 'Stage 6C: missing makeup evaluation';
  end if;

  if not exists (
    select 1 from private.academic_lesson_occurrences occurrence
    where occurrence.occurrence_key =
      private.academic_occurrence_key('regular',regular_entry,lesson_date)
      and occurrence.attendance_status='present'
      and occurrence.presented_lesson_number=1
  ) then
    raise exception 'Stage 6C: regular presentation did not persist';
  end if;

  if not exists (
    select 1 from private.academic_lesson_occurrences occurrence
    where occurrence.occurrence_key=private.academic_occurrence_key(
      'makeup','97000000-0000-4000-8000-000000000012'::uuid,lesson_date)
      and occurrence.attendance_status='present'
      and occurrence.presented_lesson_number=1
  ) then
    raise exception 'Stage 6C: makeup presentation did not persist';
  end if;

  if exists (
    select 1 from private.academic_lesson_occurrences occurrence
    where occurrence.occurrence_key =
      private.academic_occurrence_key('regular',rejected_entry,lesson_date)
  ) then
    raise exception 'Stage 6C: invalid rating left an attendance record';
  end if;

  if exists (
    select 1 from private.academic_class_session_finalizations
    where class_number=970004
  ) then
    raise exception 'Stage 6C: live class was incorrectly finalized';
  end if;
end;
$teacher_v2_6c_verify_writes$;

select 'TEACHER_V2_STAGE6C_LIVE_RPCS_PASSED' as result;
