-- Permite cadastrar aulas de gramática somente com o vídeo, sem exigir exercício.
-- Mantém os links legados e o histórico de conclusões existentes.
alter table public.grammar_lessons
  alter column exercise_url drop not null;

comment on column public.grammar_lessons.exercise_url is
  'Campo legado mantido para compatibilidade; novas aulas utilizam apenas titulo e video.';
