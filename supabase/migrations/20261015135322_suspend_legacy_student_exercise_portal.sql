-- Suspensao temporaria do Portal de Exercicios antigo.
-- Preserva catalogo, links e historico de conclusoes; o professor mantem acesso administrativo.
drop policy if exists "Alunos e professores podem visualizar exercícios" on public.teacher_exercises;
drop policy if exists "Alunos autenticados podem visualizar exercícios ativos" on public.teacher_exercises;
drop policy if exists "Apenas professores podem visualizar exercícios durante suspensão" on public.teacher_exercises;

create policy "Apenas professores podem visualizar exercícios durante suspensão"
on public.teacher_exercises
for select
to authenticated
using ((select public.is_teacher_admin()));

create or replace function public.get_public_teacher_exercises()
returns table (
  exercise_id text,
  exercise_title text,
  exercise_url text,
  scheduled_publish_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    te.exercise_id,
    te.exercise_title,
    te.exercise_url,
    te.scheduled_publish_at,
    te.created_at
  from public.teacher_exercises te
  where public.is_teacher_admin()
    and te.is_active = true
    and (te.scheduled_publish_at is null or te.scheduled_publish_at <= now())
  order by coalesce(te.scheduled_publish_at, te.created_at) desc, te.created_at desc;
$$;

revoke execute on function public.get_public_teacher_exercises() from public, anon;
grant execute on function public.get_public_teacher_exercises() to authenticated;
