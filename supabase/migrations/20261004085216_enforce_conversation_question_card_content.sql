do $validation$
declare
  total_questions integer;
  complete_questions integer;
begin
  select count(*)::integer
  into total_questions
  from public.conversation_questions;

  select count(*)::integer
  into complete_questions
  from public.conversation_questions
  where nullif(btrim(question_translation), '') is not null
    and jsonb_typeof(answer_examples) = 'array'
    and jsonb_array_length(answer_examples) = 5;

  if total_questions <> 104 then
    raise exception 'Expected 104 conversation questions, found %.', total_questions;
  end if;

  if complete_questions <> total_questions then
    raise exception 'Conversation question cards are incomplete: % of % are complete.', complete_questions, total_questions;
  end if;
end;
$validation$;

alter table public.conversation_questions
  alter column question_translation set not null,
  alter column answer_examples set not null;

alter table public.conversation_questions
  drop constraint if exists conversation_questions_translation_check,
  add constraint conversation_questions_translation_check
    check (char_length(btrim(question_translation)) between 1 and 500),
  drop constraint if exists conversation_questions_answer_examples_check,
  add constraint conversation_questions_answer_examples_check
    check (
      jsonb_typeof(answer_examples) = 'array'
      and jsonb_array_length(answer_examples) = 5
    );
