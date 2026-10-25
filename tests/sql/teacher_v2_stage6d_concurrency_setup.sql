-- Stage 6D: synthetic fixture committed ONLY to the disposable Supabase CLI database.
-- The runner applies all five immutable v2 migrations before this file.
-- Never run against a linked or production database.
alter table public.teacher_classes
  add column if not exists first_lesson_date date;
alter table public.class_students
  add column if not exists first_lesson_date date;

do $teacher_v2_6d_fixture$
declare
  local_start timestamp := (now() at time zone 'America/Sao_Paulo') - interval '15 minutes';
  current_day date := local_start::date;
  due_day date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  teacher_id constant uuid := '98000000-0000-4000-8000-000000000001';
  current_student constant uuid := '99000000-0000-4000-8000-000000000006';
  due_student constant uuid := '99000000-0000-4000-8000-000000000007';
begin
  if exists (select 1 from public.teacher_classes where class_number in (970006, 970007)) then
    raise exception 'Stage 6D: synthetic classes already exist';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', teacher_id,
     'authenticated', 'authenticated', 'teacher-v2-6d-admin@invalid.test',
     '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', current_student,
     'authenticated', 'authenticated', 'teacher-v2-6d-student-6@invalid.test',
     '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', due_student,
     'authenticated', 'authenticated', 'teacher-v2-6d-student-7@invalid.test',
     '', now(), now(), now());

  insert into public.teacher_admins(user_id, email)
  values (teacher_id, 'teacher-v2-6d-admin@invalid.test');

  insert into public.profiles(
    id, name, email, enrolled, archived, class_type, tuition_first_due_date
  ) values
    (current_student, 'ESTUDANTE V2 6D ATUAL',
     'teacher-v2-6d-student-6@invalid.test', true, false, 'QUINTETO', current_day),
    (due_student, 'ESTUDANTE V2 6D ENCERRAMENTO',
     'teacher-v2-6d-student-7@invalid.test', true, false, 'QUINTETO', due_day);

  insert into public.teacher_classes(
    class_number, class_name, class_type, class_weekday,
    class_start_time, first_lesson_date
  ) values
    (970006, 'TURMA SINTETICA V2 6D ATUAL', 'quintet',
     extract(isodow from current_day)::smallint, local_start::time, current_day),
    (970007, 'TURMA SINTETICA V2 6D VENCIDA', 'quintet',
     extract(isodow from due_day)::smallint, time '13:00', due_day);

  -- The historical-class fixture must bypass only the first-lesson date
  -- assignment trigger, exactly as stages 6A and 6C do in the disposable DB.
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.class_students'::regclass
      and tgname = 'assign_first_lesson_after_membership_trigger'
  ) then
    alter table public.class_students
      disable trigger assign_first_lesson_after_membership_trigger;
  end if;

  insert into public.class_students(class_number, user_id, first_lesson_date)
  values
    (970006, current_student, current_day),
    (970007, due_student, due_day);

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.class_students'::regclass
      and tgname = 'assign_first_lesson_after_membership_trigger'
  ) then
    alter table public.class_students
      enable trigger assign_first_lesson_after_membership_trigger;
  end if;

  insert into public.conversation_questions(
    id, question_text, display_order, question_translation, answer_examples
  ) values (
    '97000000-0000-4000-8000-000000000016',
    'Did the two database sessions agree?', 999998,
    'As duas sessões do banco concordaram?',
    '["Yes, they did.","The rating is stable.","There was one evaluation.","The lock worked.","No duplicate was saved."]'::jsonb
  );

  insert into private.student_question_studies(student_id, question_id)
  values (current_student, '97000000-0000-4000-8000-000000000016');

  if (select count(*) from public.class_students
      where class_number in (970006, 970007)) <> 2 then
    raise exception 'Stage 6D: synthetic memberships not created';
  end if;

  -- cron is never enabled for this fixture until the first writer has its lock.
  if not exists (
    select 1 from private.academic_v2_automation_control
    where singleton is true and enabled is false and enabled_from is null
  ) then
    raise exception 'Stage 6D: automation must start disabled';
  end if;
end;
$teacher_v2_6d_fixture$;
