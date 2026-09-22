-- Classificação do tipo de turma de cada aluno.
-- Valores permitidos: INDIVIDUAL, QUARTETO, QUINTETO e 8 ALUNOS.

alter table public.profiles
  add column if not exists class_type text;

alter table public.profiles
  drop constraint if exists profiles_class_type_check;

alter table public.profiles
  add constraint profiles_class_type_check
  check (class_type is null or class_type in ('INDIVIDUAL', 'QUARTETO', 'QUINTETO', '8 ALUNOS'));

comment on column public.profiles.class_type is
  'Tipo de turma definido pelo professor: INDIVIDUAL, QUARTETO, QUINTETO ou 8 ALUNOS.';
