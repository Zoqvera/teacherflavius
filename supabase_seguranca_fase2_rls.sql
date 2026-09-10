-- Segurança do Supabase — Fase 2: políticas RLS
--
-- Objetivos:
--   1. substituir o papel amplo PUBLIC por authenticated;
--   2. consolidar políticas permissivas duplicadas;
--   3. avaliar auth.uid(), auth.jwt() e is_teacher_admin() uma vez por consulta;
--   4. preservar a separação entre acesso do aluno e acesso administrativo.
--
-- O script não altera tabelas, colunas nem dados. Todas as mudanças ficam dentro
-- de uma transação e são desfeitas se as verificações finais falharem.

begin;

-- ---------------------------------------------------------------------------
-- Políticas simples: mesmo acesso, agora restrito a authenticated e otimizado.
-- ---------------------------------------------------------------------------

alter policy "Users can read own activity results"
  on public.activity_results
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "Users can insert own activity results"
  on public.activity_results
  to authenticated
  with check ((select auth.uid()) = user_id);

alter policy "Alunos podem ver seus exercícios diários"
  on public.daily_exercise_completion
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "Alunos podem inserir seus exercícios diários"
  on public.daily_exercise_completion
  to authenticated
  with check ((select auth.uid()) = user_id);

alter policy "Alunos podem atualizar seus exercícios diários"
  on public.daily_exercise_completion
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Alunos podem visualizar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  to authenticated
  using (user_id = (select auth.uid()));

alter policy "Alunos podem criar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  to authenticated
  with check (user_id = (select auth.uid()));

alter policy "Alunos podem atualizar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "Users can insert own profile"
  on public.profiles
  to authenticated
  with check ((select auth.uid()) = id);

alter policy "Professores podem visualizar matrículas"
  on public.student_enrollments
  to authenticated
  using ((select public.is_teacher_admin()));

alter policy "Alunos podem ver sua própria frequência"
  on public.student_frequency
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "Usuários podem inserir sua própria frequência"
  on public.student_frequency
  to authenticated
  with check ((select auth.uid()) = user_id);

alter policy "Usuários podem atualizar sua própria frequência"
  on public.student_frequency
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Usuários podem apagar sua própria frequência"
  on public.student_frequency
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "Alunos podem inserir seus próprios dados privados"
  on public.student_private_data
  to authenticated
  with check ((select auth.uid()) = user_id);

alter policy "Alunos podem atualizar seus próprios dados privados"
  on public.student_private_data
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Alunos podem ver suas lições do roteiro"
  on public.study_roadmap_completion
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Alunos podem inserir suas lições do roteiro"
  on public.study_roadmap_completion;
drop policy if exists "Alunos podem atualizar suas lições do roteiro"
  on public.study_roadmap_completion;

drop policy if exists "Professor pode inserir progresso do roteiro"
  on public.study_roadmap_completion;
create policy "Professor pode inserir progresso do roteiro"
  on public.study_roadmap_completion
  for insert
  to authenticated
  with check ((select public.is_teacher_admin()));

drop policy if exists "Professor pode atualizar progresso do roteiro"
  on public.study_roadmap_completion;
create policy "Professor pode atualizar progresso do roteiro"
  on public.study_roadmap_completion
  for update
  to authenticated
  using ((select public.is_teacher_admin()))
  with check ((select public.is_teacher_admin()));

drop policy if exists "Professor pode excluir progresso do roteiro"
  on public.study_roadmap_completion;
create policy "Professor pode excluir progresso do roteiro"
  on public.study_roadmap_completion
  for delete
  to authenticated
  using ((select public.is_teacher_admin()));

alter policy "Professor pode verificar suas próprias credenciais"
  on public.teacher_admins
  to authenticated
  using (
    lower(email) = lower((select auth.jwt()) ->> 'email')
  );

-- ---------------------------------------------------------------------------
-- Registros de lições: uma política de leitura e operações administrativas
-- separadas. O OR preserva a combinação permissiva das políticas anteriores.
-- ---------------------------------------------------------------------------

drop policy "Alunos podem visualizar seus registros de lições"
  on public.class_lesson_records;
drop policy "Professores podem gerenciar registros de lições"
  on public.class_lesson_records;

create policy "Alunos e professores podem visualizar registros de lições"
  on public.class_lesson_records
  for select
  to authenticated
  using (
    (select public.is_teacher_admin())
    or (select auth.uid()) = user_id
  );

create policy "Professores podem inserir registros de lições"
  on public.class_lesson_records
  for insert
  to authenticated
  with check ((select public.is_teacher_admin()));

create policy "Professores podem atualizar registros de lições"
  on public.class_lesson_records
  for update
  to authenticated
  using ((select public.is_teacher_admin()))
  with check ((select public.is_teacher_admin()));

create policy "Professores podem excluir registros de lições"
  on public.class_lesson_records
  for delete
  to authenticated
  using ((select public.is_teacher_admin()));

-- ---------------------------------------------------------------------------
-- Recursos de turma.
-- ---------------------------------------------------------------------------

drop policy "Alunos podem visualizar links da própria turma"
  on public.class_resources;
drop policy "Professores podem gerenciar links das turmas"
  on public.class_resources;

create policy "Alunos e professores podem visualizar recursos da turma"
  on public.class_resources
  for select
  to authenticated
  using (
    (select public.is_teacher_admin())
    or exists (
      select 1
      from public.class_students cs
      where cs.class_number = class_resources.class_number
        and cs.user_id = (select auth.uid())
    )
  );

create policy "Professores podem inserir recursos da turma"
  on public.class_resources
  for insert
  to authenticated
  with check ((select public.is_teacher_admin()));

create policy "Professores podem atualizar recursos da turma"
  on public.class_resources
  for update
  to authenticated
  using ((select public.is_teacher_admin()))
  with check ((select public.is_teacher_admin()));

create policy "Professores podem excluir recursos da turma"
  on public.class_resources
  for delete
  to authenticated
  using ((select public.is_teacher_admin()));

-- ---------------------------------------------------------------------------
-- Alunos vinculados às turmas.
-- ---------------------------------------------------------------------------

drop policy "Alunos podem visualizar sua própria turma"
  on public.class_students;
drop policy "Professores podem visualizar alunos das turmas"
  on public.class_students;

create policy "Alunos e professores podem visualizar vínculos de turma"
  on public.class_students
  for select
  to authenticated
  using (
    (select public.is_teacher_admin())
    or (select auth.uid()) = user_id
  );

-- ---------------------------------------------------------------------------
-- Perfis: aluno acessa o próprio perfil; professor acessa todos.
-- ---------------------------------------------------------------------------

drop policy "Users can read own profile" on public.profiles;
drop policy "Professores podem visualizar perfis" on public.profiles;
drop policy "Users can update own profile" on public.profiles;
drop policy "Professores podem editar perfis" on public.profiles;

create policy "Alunos e professores podem visualizar perfis"
  on public.profiles
  for select
  to authenticated
  using (
    (select public.is_teacher_admin())
    or (select auth.uid()) = id
  );

create policy "Alunos e professores podem atualizar perfis"
  on public.profiles
  for update
  to authenticated
  using (
    (select public.is_teacher_admin())
    or (select auth.uid()) = id
  )
  with check (
    (select public.is_teacher_admin())
    or (select auth.uid()) = id
  );

-- ---------------------------------------------------------------------------
-- Dados privados: aluno acessa os próprios dados; professor tem leitura.
-- ---------------------------------------------------------------------------

drop policy "Alunos podem visualizar seus próprios dados privados"
  on public.student_private_data;
drop policy "Professores podem visualizar dados privados de alunos"
  on public.student_private_data;

create policy "Alunos e professores podem visualizar dados privados"
  on public.student_private_data
  for select
  to authenticated
  using (
    (select public.is_teacher_admin())
    or (select auth.uid()) = user_id
  );

-- ---------------------------------------------------------------------------
-- Turmas: aluno visualiza sua turma; professor administra todas.
-- ---------------------------------------------------------------------------

drop policy "Alunos podem visualizar turmas em que estão inscritos"
  on public.teacher_classes;
drop policy "Professores podem gerenciar turmas"
  on public.teacher_classes;

create policy "Alunos e professores podem visualizar turmas"
  on public.teacher_classes
  for select
  to authenticated
  using (
    (select public.is_teacher_admin())
    or exists (
      select 1
      from public.class_students cs
      where cs.class_number = teacher_classes.class_number
        and cs.user_id = (select auth.uid())
    )
  );

create policy "Professores podem inserir turmas"
  on public.teacher_classes
  for insert
  to authenticated
  with check ((select public.is_teacher_admin()));

create policy "Professores podem atualizar turmas"
  on public.teacher_classes
  for update
  to authenticated
  using ((select public.is_teacher_admin()))
  with check ((select public.is_teacher_admin()));

create policy "Professores podem excluir turmas"
  on public.teacher_classes
  for delete
  to authenticated
  using ((select public.is_teacher_admin()));

-- ---------------------------------------------------------------------------
-- Exercícios: aluno visualiza somente os ativos/publicados; professor gerencia.
-- ---------------------------------------------------------------------------

drop policy "Alunos autenticados podem visualizar exercícios ativos"
  on public.teacher_exercises;
drop policy "Professores podem gerenciar exercícios"
  on public.teacher_exercises;

create policy "Alunos e professores podem visualizar exercícios"
  on public.teacher_exercises
  for select
  to authenticated
  using (
    (select public.is_teacher_admin())
    or (
      (select auth.uid()) is not null
      and is_active = true
      and (
        scheduled_publish_at is null
        or scheduled_publish_at <= now()
      )
    )
  );

create policy "Professores podem inserir exercícios"
  on public.teacher_exercises
  for insert
  to authenticated
  with check ((select public.is_teacher_admin()));

create policy "Professores podem atualizar exercícios"
  on public.teacher_exercises
  for update
  to authenticated
  using ((select public.is_teacher_admin()))
  with check ((select public.is_teacher_admin()));

create policy "Professores podem excluir exercícios"
  on public.teacher_exercises
  for delete
  to authenticated
  using ((select public.is_teacher_admin()));

-- ---------------------------------------------------------------------------
-- Verificações: falhar fechado e desfazer toda a transação.
-- ---------------------------------------------------------------------------

do $security_checks$
declare
  duplicate_group_count integer;
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and 'public' = any(roles)
  ) then
    raise exception 'Segurança: ainda existe política RLS atribuída a PUBLIC.';
  end if;

  with expanded_policies as (
    select
      p.tablename,
      role_name,
      action_name
    from pg_policies p
    cross join lateral unnest(p.roles) as role_name
    cross join lateral unnest(
      case
        when p.cmd = 'ALL'
          then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
        else array[p.cmd]::text[]
      end
    ) as action_name
    where p.schemaname = 'public'
      and p.permissive = 'PERMISSIVE'
      and role_name = 'authenticated'
  ),
  duplicate_groups as (
    select tablename, role_name, action_name
    from expanded_policies
    group by tablename, role_name, action_name
    having count(*) > 1
  )
  select count(*)
    into duplicate_group_count
  from duplicate_groups;

  if duplicate_group_count > 0 then
    raise exception
      'Segurança: ainda existem % grupos de políticas permissivas duplicadas.',
      duplicate_group_count;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Alunos e professores podem visualizar perfis'
      and roles = array['authenticated']::name[]
  ) then
    raise exception 'Segurança: política consolidada de perfis não foi criada.';
  end if;
end;
$security_checks$;

commit;

-- Relatório esperado:
--   policies_for_public = 0
--   duplicate_permissive_groups = 0
with expanded_policies as (
  select
    p.tablename,
    role_name,
    action_name
  from pg_policies p
  cross join lateral unnest(p.roles) as role_name
  cross join lateral unnest(
    case
      when p.cmd = 'ALL'
        then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
      else array[p.cmd]::text[]
    end
  ) as action_name
  where p.schemaname = 'public'
    and p.permissive = 'PERMISSIVE'
    and role_name = 'authenticated'
),
duplicate_groups as (
  select tablename, role_name, action_name
  from expanded_policies
  group by tablename, role_name, action_name
  having count(*) > 1
)
select
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and 'public' = any(roles)
  ) as policies_for_public,
  (select count(*) from duplicate_groups) as duplicate_permissive_groups;
