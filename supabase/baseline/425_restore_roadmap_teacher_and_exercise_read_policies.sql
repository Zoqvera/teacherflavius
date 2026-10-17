-- ETAPA 1D.4B: restore four missing, reviewed RLS policies ONLY to the
-- isolated canonical recovery schema. This is NOT a production migration.
--
-- Sources of the original authorization semantics:
-- 20260909071400_restrict_study_roadmap_completion_to_teacher.sql
-- 20261015135322_suspend_legacy_student_exercise_portal.sql
--
-- No permissions for students to write progress or view suspended exercises.
do $verify_missing_academic_rls$
begin
  if to_regclass('public.study_roadmap_completion') is null
    or to_regclass('public.teacher_exercises') is null then
    raise exception 'Academic tables must be restored before their policies';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    where c.oid in (
      'public.study_roadmap_completion'::regclass,
      'public.teacher_exercises'::regclass
    )
      and not c.relrowsecurity
  ) then
    raise exception 'Academic tables must have RLS enabled';
  end if;

  -- The prior baseline must expose only the student's own SELECT
  -- and teacher's existing SELECT on the roadmap (predicates unchanged), plus the three
  -- teacher write policies on the suspended exercise catalog.
  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'study_roadmap_completion'
  ) <> 2 or (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'teacher_exercises'
  ) <> 3 then
    raise exception 'Unexpected legacy academic policy counts';
  end if;

  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'study_roadmap_completion'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and (
        (
          policyname = 'Alunos podem ver suas lições do roteiro'
          and cmd = 'SELECT'
        ) or (
          policyname = 'Professor pode visualizar progresso do roteiro'
          and cmd = 'SELECT'
        )
      )
  ) <> 2 then
    raise exception 'Student and teacher baseline roadmap SELECT policies drifted';
  end if;

  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'teacher_exercises'
      and policyname in (
        'Professores podem atualizar exercícios',
        'Professores podem excluir exercícios',
        'Professores podem inserir exercícios'
      )
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
  ) <> 3 then
    raise exception 'Suspended exercise catalog baseline permissions drifted';
  end if;
end;
$verify_missing_academic_rls$;

create policy "Professor pode inserir progresso do roteiro"
  on public.study_roadmap_completion
  for insert
  to authenticated
  with check ((select public.is_teacher_admin()));

create policy "Professor pode atualizar progresso do roteiro"
  on public.study_roadmap_completion
  for update
  to authenticated
  using ((select public.is_teacher_admin()))
  with check ((select public.is_teacher_admin()));

create policy "Professor pode excluir progresso do roteiro"
  on public.study_roadmap_completion
  for delete
  to authenticated
  using ((select public.is_teacher_admin()));

create policy "Apenas professores podem visualizar exercícios durante suspensão"
  on public.teacher_exercises
  for select
  to authenticated
  using ((select public.is_teacher_admin()));

do $verify_restored_academic_rls$
begin
  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'study_roadmap_completion'
  ) <> 5 or (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'teacher_exercises'
  ) <> 4 then
    raise exception 'Academic RLS policy restoration is incomplete';
  end if;

  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('study_roadmap_completion', 'teacher_exercises')
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and (
        (
          tablename = 'study_roadmap_completion'
          and policyname in (
            'Professor pode inserir progresso do roteiro',
            'Professor pode atualizar progresso do roteiro',
            'Professor pode excluir progresso do roteiro'
          )
          and (
            coalesce(qual, '') like '%is_teacher_admin()%'
            or coalesce(with_check, '') like '%is_teacher_admin()%'
          )
        ) or (
          tablename = 'teacher_exercises'
          and policyname = 'Apenas professores podem visualizar exercícios durante suspensão'
          and cmd = 'SELECT'
          and qual like '%is_teacher_admin()%'
          and with_check is null
        )
      )
  ) <> 4 then
    raise exception 'Restored RLS predicates do not match reviewed teacher gates';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'study_roadmap_completion'
      and policyname like 'Alunos podem %'
      and cmd in ('INSERT','UPDATE','DELETE','ALL')
  ) then
    raise exception 'Direct student roadmap mutations must stay disabled';
  end if;
end;
$verify_restored_academic_rls$;
