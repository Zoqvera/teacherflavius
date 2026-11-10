-- Aulas de gramática
-- Execute este arquivo no Supabase em SQL Editor > Run.
-- Este script cria as tabelas usadas por aulas-de-gramatica.html e aulas-de-gramatica-interface-do-professor.html.

create table if not exists public.grammar_lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  video_url text not null,
  exercise_url text, -- Campo legado opcional; novas aulas utilizam apenas vídeo.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.grammar_lessons enable row level security;

drop policy if exists "Alunos autenticados podem visualizar aulas de gramatica" on public.grammar_lessons;
create policy "Alunos autenticados podem visualizar aulas de gramatica"
  on public.grammar_lessons
  for select
  to authenticated
  using (true);

drop policy if exists "Professores podem criar aulas de gramatica" on public.grammar_lessons;
create policy "Professores podem criar aulas de gramatica"
  on public.grammar_lessons
  for insert
  to authenticated
  with check (public.is_teacher_admin());

drop policy if exists "Professores podem editar aulas de gramatica" on public.grammar_lessons;
create policy "Professores podem editar aulas de gramatica"
  on public.grammar_lessons
  for update
  to authenticated
  using (public.is_teacher_admin())
  with check (public.is_teacher_admin());

drop policy if exists "Professores podem excluir aulas de gramatica" on public.grammar_lessons;
create policy "Professores podem excluir aulas de gramatica"
  on public.grammar_lessons
  for delete
  to authenticated
  using (public.is_teacher_admin());

create index if not exists grammar_lessons_created_at_idx
  on public.grammar_lessons (created_at desc);

create table if not exists public.grammar_lesson_completion (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.grammar_lessons(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

alter table public.grammar_lesson_completion enable row level security;

drop policy if exists "Alunos podem visualizar suas conclusoes de gramatica" on public.grammar_lesson_completion;
create policy "Alunos podem visualizar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Alunos podem criar suas conclusoes de gramatica" on public.grammar_lesson_completion;
create policy "Alunos podem criar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Alunos podem atualizar suas conclusoes de gramatica" on public.grammar_lesson_completion;
create policy "Alunos podem atualizar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists grammar_lesson_completion_user_id_idx
  on public.grammar_lesson_completion (user_id);

create index if not exists grammar_lesson_completion_lesson_id_idx
  on public.grammar_lesson_completion (lesson_id);
