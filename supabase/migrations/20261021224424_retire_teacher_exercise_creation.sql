-- Descontinuação do cadastro de exercícios, preservando catálogo e histórico.
-- Mantém funções de consulta e a integração de registros já existentes.
revoke execute on function public.create_teacher_exercise(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.delete_teacher_exercise(uuid)
  from public, anon, authenticated;
revoke insert, update, delete on table public.teacher_exercises
  from public, anon, authenticated;