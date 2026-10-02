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
  ('What languages do you speak?', 15),
  ('Are you learning any languages?', 16),
  ('What is your favorite language?', 17),
  ('What time do you usually wake up?', 18),
  ('What do you usually do in the morning?', 19),
  ('What do you usually have for breakfast?', 20),
  ('What time do you start work or school?', 21),
  ('What do you usually do during the day?', 22),
  ('What time do you usually go to bed?', 23),
  ('Are you a morning person or a night person?', 24),
  ('What do you like to do in your free time?', 25),
  ('What are your hobbies?', 26),
  ('Do you like reading?', 27),
  ('What kind of books do you like?', 28),
  ('What is your favorite book?', 29),
  ('Do you like watching movies?', 30),
  ('What kind of movies do you like?', 31),
  ('What is your favorite movie?', 32),
  ('Do you watch TV series?', 33),
  ('What is your favorite TV series?', 34),
  ('Do you like listening to music?', 35),
  ('What kind of music do you like?', 36),
  ('Who is your favorite singer or band?', 37),
  ('What is your favorite song?', 38),
  ('Do you play any musical instruments?', 39),
  ('Do you like sports?', 40),
  ('What is your favorite sport?', 41),
  ('Do you play any sports?', 42),
  ('Do you exercise regularly?', 43),
  ('Do you go to the gym?', 44),
  ('What is your favorite food?', 45),
  ('What food do you dislike?', 46),
  ('Can you cook?', 47),
  ('What is your favorite dish to cook?', 48),
  ('Do you prefer coffee or tea?', 49),
  ('What is your favorite drink?', 50),
  ('Do you like trying new foods?', 51),
  ('What is your favorite restaurant?', 52),
  ('Do you like traveling?', 53),
  ('What countries have you visited?', 54),
  ('What is your favorite place you have visited?', 55),
  ('Where would you like to travel next?', 56),
  ('What is your dream destination?', 57),
  ('Do you prefer the beach or the mountains?', 58),
  ('Do you prefer big cities or small towns?', 59),
  ('What is your favorite city?', 60),
  ('What do you like about the city where you live?', 61),
  ('Would you like to live in another country?', 62),
  ('What is your favorite day of the week?', 63),
  ('What is your favorite season?', 64),
  ('What is your favorite holiday?', 65),
  ('What do you usually do on weekends?', 66),
  ('What did you do last weekend?', 67),
  ('What are you going to do next weekend?', 68),
  ('Do you like going out with friends?', 69),
  ('How often do you see your friends?', 70),
  ('What do you usually do with your friends?', 71),
  ('What qualities do you value in a friend?', 72),
  ('Are you a shy person?', 73),
  ('Are you an organized person?', 74),
  ('Are you usually calm or energetic?', 75),
  ('Do you like meeting new people?', 76),
  ('Do you prefer talking or listening?', 77),
  ('What makes you happy?', 78),
  ('What makes you laugh?', 79),
  ('What helps you relax?', 80),
  ('What are you afraid of?', 81),
  ('What are you proud of?', 82),
  ('What is something you are good at?', 83),
  ('What would you like to learn?', 84),
  ('What is something new you learned recently?', 85),
  ('What was your favorite subject at school?', 86),
  ('Did you enjoy school?', 87),
  ('What is your dream job?', 88),
  ('Do you like your current job?', 89),
  ('What is the best thing about your job?', 90),
  ('What is the most difficult thing about your job?', 91),
  ('Would you like to change careers someday?', 92),
  ('What are your plans for the future?', 93),
  ('Where do you see yourself in five years?', 94),
  ('What is one goal you want to achieve?', 95),
  ('What is something you want to do this year?', 96),
  ('If you could learn any skill, what would you choose?', 97),
  ('If you could live anywhere in the world, where would you live?', 98),
  ('If you could meet any famous person, who would you choose?', 99),
  ('If you had a free day tomorrow, what would you do?', 100),
  ('What is something most people do not know about you?', 101);
