-- Insert two conversation prompts after question 14 while preserving all existing question IDs and completion history.

do $migration$
begin
  if exists (
    select 1
    from public.conversation_questions
    where question_text in ('What''s you phone number?', 'What''s your address?')
  ) then
    raise exception 'The new conversation questions already exist.';
  end if;

  if not exists (
    select 1
    from public.conversation_questions
    where question_text = 'Do you have any pets?'
      and display_order = 14
  ) then
    raise exception 'Expected current question 14 was not found.';
  end if;

  update public.conversation_questions
  set display_order = display_order + 2
  where display_order >= 15;

  insert into public.conversation_questions (question_text, display_order)
  values
    ('What''s you phone number?', 15),
    ('What''s your address?', 16);
end;
$migration$;
