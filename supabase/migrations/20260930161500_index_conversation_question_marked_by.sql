create index if not exists conversation_question_completions_marked_by_idx
  on public.conversation_question_completions (marked_by)
  where marked_by is not null;
