alter table public.conversation_questions
  add column if not exists question_translation text,
  add column if not exists answer_examples jsonb;

comment on column public.conversation_questions.question_translation is
  'Portuguese translation displayed with the English conversation question.';

comment on column public.conversation_questions.answer_examples is
  'Exactly five modeled answers. Each item stores answer, Portuguese translation, and usage note.';
