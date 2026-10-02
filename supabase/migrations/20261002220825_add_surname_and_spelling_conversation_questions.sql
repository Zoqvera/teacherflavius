-- Insert two conversation prompts after question 07 while preserving all existing question IDs and completion history.

do $migration$
begin
  if exists (
    select 1
    from public.conversation_questions
    where question_text in ('What''s your surname?', 'How do you spell your name?')
  ) then
    raise exception 'The new conversation questions already exist.';
  end if;

  if not exists (
    select 1
    from public.conversation_questions
    where question_text = 'What is your full name?'
      and display_order = 8
  ) then
    raise exception 'Expected current question 08 was not found.';
  end if;

  update public.conversation_questions
  set display_order = display_order + 2
  where display_order >= 8;

  insert into public.conversation_questions (question_text, display_order)
  values
    ('What''s your surname?', 8),
    ('How do you spell your name?', 9);
end;
$migration$;
