create table public.conversation_questions (
  id uuid primary key default gen_random_uuid(),
  question_text text not null check (char_length(btrim(question_text)) between 1 and 500),
  display_order integer not null check (display_order > 0),
  created_at timestamptz not null default now()
);

create index conversation_questions_display_order_idx
  on public.conversation_questions (display_order, id);

alter table public.conversation_questions enable row level security;

grant select, insert, update on table public.conversation_questions to authenticated;
revoke all on table public.conversation_questions from anon;

create policy "Authenticated active students and teachers can view conversation questions"
on public.conversation_questions
for select
to authenticated
using (
  (select public.is_teacher_admin())
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.enrolled = true
      and p.archived = false
  )
);

create policy "Teachers can add conversation questions"
on public.conversation_questions
for insert
to authenticated
with check ((select public.is_teacher_admin()));

create policy "Teachers can reorder conversation questions"
on public.conversation_questions
for update
to authenticated
using ((select public.is_teacher_admin()))
with check ((select public.is_teacher_admin()));

create table public.conversation_question_completions (
  question_id uuid not null references public.conversation_questions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  marked_by uuid references auth.users(id) on delete set null,
  primary key (question_id, student_id)
);

create index conversation_question_completions_student_idx
  on public.conversation_question_completions (student_id, question_id);

create index conversation_question_completions_marked_by_idx
  on public.conversation_question_completions (marked_by)
  where marked_by is not null;

alter table public.conversation_question_completions enable row level security;

grant select, insert, delete on table public.conversation_question_completions to authenticated;
revoke all on table public.conversation_question_completions from anon;

create policy "Students can view own conversation progress and teachers can view all"
on public.conversation_question_completions
for select
to authenticated
using (
  (select public.is_teacher_admin())
  or student_id = (select auth.uid())
);

create policy "Teachers can mark conversation questions"
on public.conversation_question_completions
for insert
to authenticated
with check (
  (select public.is_teacher_admin())
  and marked_by = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = student_id
      and p.enrolled = true
      and p.archived = false
  )
);

create policy "Teachers can unmark conversation questions"
on public.conversation_question_completions
for delete
to authenticated
using ((select public.is_teacher_admin()));

create or replace function public.move_conversation_question(
  p_question_id uuid,
  p_direction text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  current_order integer;
  target_id uuid;
  target_order integer;
begin
  if not (select public.is_teacher_admin()) then
    raise exception 'Teacher access required.' using errcode = '42501';
  end if;

  if p_direction not in ('up', 'down') then
    raise exception 'Invalid direction.' using errcode = '22023';
  end if;

  select display_order
  into current_order
  from public.conversation_questions
  where id = p_question_id
  for update;

  if current_order is null then
    raise exception 'Conversation question not found.' using errcode = 'P0002';
  end if;

  if p_direction = 'up' then
    select id, display_order
    into target_id, target_order
    from public.conversation_questions
    where display_order < current_order
    order by display_order desc, id desc
    limit 1
    for update;
  else
    select id, display_order
    into target_id, target_order
    from public.conversation_questions
    where display_order > current_order
    order by display_order asc, id asc
    limit 1
    for update;
  end if;

  if target_id is null then
    return;
  end if;

  update public.conversation_questions
  set display_order = current_order
  where id = target_id;

  update public.conversation_questions
  set display_order = target_order
  where id = p_question_id;
end;
$function$;

revoke all on function public.move_conversation_question(uuid, text) from public;
grant execute on function public.move_conversation_question(uuid, text) to authenticated;

insert into public.conversation_questions (question_text, display_order)
values
  ('How are you?', 1),
  ('Where are you from?', 2),
  ('Where do you live?', 3),
  ('How old are you?', 4),
  ('What do you do for work?', 5),
  ('Where do you work?', 6),
  ('Are you married or single?', 7),
  ('What''s your surname?', 8),
  ('How do you spell your name?', 9),
  ('What is your full name?', 10),
  ('Do you have children?', 11),
  ('Do you have any brothers or sisters?', 12),
  ('Who do you live with?', 13),
  ('Do you have any pets?', 14),
  ('What''s you phone number?', 15),
  ('What''s your address?', 16),
  ('What languages do you speak?', 17),
  ('Are you learning any languages?', 18),
  ('What is your favorite language?', 19),
  ('What time do you usually wake up?', 20),
  ('What do you usually do in the morning?', 21),
  ('What do you usually have for breakfast?', 22),
  ('What time do you start work or school?', 23),
  ('What do you usually do during the day?', 24),
  ('What time do you usually go to bed?', 25),
  ('Are you a morning person or a night person?', 26),
  ('What do you like to do in your free time?', 27),
  ('What are your hobbies?', 28),
  ('Do you like reading?', 29),
  ('What kind of books do you like?', 30),
  ('What is your favorite book?', 31),
  ('Do you like watching movies?', 32),
  ('What kind of movies do you like?', 33),
  ('What is your favorite movie?', 34),
  ('Do you watch TV series?', 35),
  ('What is your favorite TV series?', 36),
  ('Do you like listening to music?', 37),
  ('What kind of music do you like?', 38),
  ('Who is your favorite singer or band?', 39),
  ('What is your favorite song?', 40),
  ('Do you play any musical instruments?', 41),
  ('Do you like sports?', 42),
  ('What is your favorite sport?', 43),
  ('Do you play any sports?', 44),
  ('Do you exercise regularly?', 45),
  ('Do you go to the gym?', 46),
  ('What is your favorite food?', 47),
  ('What food do you dislike?', 48),
  ('Can you cook?', 49),
  ('What is your favorite dish to cook?', 50),
  ('Do you prefer coffee or tea?', 51),
  ('What is your favorite drink?', 52),
  ('Do you like trying new foods?', 53),
  ('What is your favorite restaurant?', 54),
  ('Do you like traveling?', 55),
  ('What countries have you visited?', 56),
  ('What is your favorite place you have visited?', 57),
  ('Where would you like to travel next?', 58),
  ('What is your dream destination?', 59),
  ('Do you prefer the beach or the mountains?', 60),
  ('Do you prefer big cities or small towns?', 61),
  ('What is your favorite city?', 62),
  ('What do you like about the city where you live?', 63),
  ('Would you like to live in another country?', 64),
  ('What is your favorite day of the week?', 65),
  ('What is your favorite season?', 66),
  ('What is your favorite holiday?', 67),
  ('What do you usually do on weekends?', 68),
  ('What did you do last weekend?', 69),
  ('What are you going to do next weekend?', 70),
  ('Do you like going out with friends?', 71),
  ('How often do you see your friends?', 72),
  ('What do you usually do with your friends?', 73),
  ('What qualities do you value in a friend?', 74),
  ('Are you a shy person?', 75),
  ('Are you an organized person?', 76),
  ('Are you usually calm or energetic?', 77),
  ('Do you like meeting new people?', 78),
  ('Do you prefer talking or listening?', 79),
  ('What makes you happy?', 80),
  ('What makes you laugh?', 81),
  ('What helps you relax?', 82),
  ('What are you afraid of?', 83),
  ('What are you proud of?', 84),
  ('What is something you are good at?', 85),
  ('What would you like to learn?', 86),
  ('What is something new you learned recently?', 87),
  ('What was your favorite subject at school?', 88),
  ('Did you enjoy school?', 89),
  ('What is your dream job?', 90),
  ('Do you like your current job?', 91),
  ('What is the best thing about your job?', 92),
  ('What is the most difficult thing about your job?', 93),
  ('Would you like to change careers someday?', 94),
  ('What are your plans for the future?', 95),
  ('Where do you see yourself in five years?', 96),
  ('What is one goal you want to achieve?', 97),
  ('What is something you want to do this year?', 98),
  ('If you could learn any skill, what would you choose?', 99),
  ('If you could live anywhere in the world, where would you live?', 100),
  ('If you could meet any famous person, who would you choose?', 101),
  ('If you had a free day tomorrow, what would you do?', 102),
  ('What is something most people do not know about you?', 103);
