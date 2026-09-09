-- Rollback emergencial da Segurança do Supabase — Fase 2
--
-- Restaura as políticas existentes antes da Fase 2. A Fase 1 permanece ativa:
-- anon continua sem EXECUTE nas funções e os search_path seguros são preservados.

begin;

-- Remove políticas consolidadas e políticas administrativas separadas.
drop policy if exists "Alunos e professores podem visualizar registros de lições"
  on public.class_lesson_records;
drop policy if exists "Professores podem inserir registros de lições"
  on public.class_lesson_records;
drop policy if exists "Professores podem atualizar registros de lições"
  on public.class_lesson_records;
drop policy if exists "Professores podem excluir registros de lições"
  on public.class_lesson_records;

drop policy if exists "Alunos e professores podem visualizar recursos da turma"
  on public.class_resources;
drop policy if exists "Professores podem inserir recursos da turma"
  on public.class_resources;
drop policy if exists "Professores podem atualizar recursos da turma"
  on public.class_resources;
drop policy if exists "Professores podem excluir recursos da turma"
  on public.class_resources;

drop policy if exists "Alunos e professores podem visualizar vínculos de turma"
  on public.class_students;

drop policy if exists "Alunos e professores podem visualizar perfis"
  on public.profiles;
drop policy if exists "Alunos e professores podem atualizar perfis"
  on public.profiles;

drop policy if exists "Alunos e professores podem visualizar dados privados"
  on public.student_private_data;

drop policy if exists "Alunos e professores podem visualizar turmas"
  on public.teacher_classes;
drop policy if exists "Professores podem inserir turmas"
  on public.teacher_classes;
drop policy if exists "Professores podem atualizar turmas"
  on public.teacher_classes;
drop policy if exists "Professores podem excluir turmas"
  on public.teacher_classes;

drop policy if exists "Alunos e professores podem visualizar exercícios"
  on public.teacher_exercises;
drop policy if exists "Professores podem inserir exercícios"
  on public.teacher_exercises;
drop policy if exists "Professores podem atualizar exercícios"
  on public.teacher_exercises;
drop policy if exists "Professores podem excluir exercícios"
  on public.teacher_exercises;

-- Restaura políticas originais que foram consolidadas.
create policy "Alunos podem visualizar seus registros de lições"
  on public.class_lesson_records
  for select
  to public
  using (auth.uid() = user_id);

create policy "Professores podem gerenciar registros de lições"
  on public.class_lesson_records
  for all
  to public
  using (is_teacher_admin())
  with check (is_teacher_admin());

create policy "Alunos podem visualizar links da própria turma"
  on public.class_resources
  for select
  to public
  using (
    exists (
      select 1
      from public.class_students cs
      where cs.class_number = class_resources.class_number
        and cs.user_id = auth.uid()
    )
  );

create policy "Professores podem gerenciar links das turmas"
  on public.class_resources
  for all
  to public
  using (is_teacher_admin())
  with check (is_teacher_admin());

create policy "Alunos podem visualizar sua própria turma"
  on public.class_students
  for select
  to public
  using (auth.uid() = user_id);

create policy "Professores podem visualizar alunos das turmas"
  on public.class_students
  for select
  to public
  using (is_teacher_admin());

create policy "Users can read own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "Professores podem visualizar perfis"
  on public.profiles
  for select
  to public
  using (
    exists (
      select 1
      from public.teacher_admins ta
      where lower(ta.email) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Professores podem editar perfis"
  on public.profiles
  for update
  to public
  using (
    exists (
      select 1
      from public.teacher_admins ta
      where lower(ta.email) = lower(auth.jwt() ->> 'email')
    )
  )
  with check (
    exists (
      select 1
      from public.teacher_admins ta
      where lower(ta.email) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "Alunos podem visualizar seus próprios dados privados"
  on public.student_private_data
  for select
  to public
  using (auth.uid() = user_id);

create policy "Professores podem visualizar dados privados de alunos"
  on public.student_private_data
  for select
  to public
  using (is_teacher_admin());

create policy "Alunos podem visualizar turmas em que estão inscritos"
  on public.teacher_classes
  for select
  to public
  using (
    exists (
      select 1
      from public.class_students cs
      where cs.class_number = teacher_classes.class_number
        and cs.user_id = auth.uid()
    )
  );

create policy "Professores podem gerenciar turmas"
  on public.teacher_classes
  for all
  to public
  using (is_teacher_admin())
  with check (is_teacher_admin());

create policy "Alunos autenticados podem visualizar exercícios ativos"
  on public.teacher_exercises
  for select
  to public
  using (
    auth.uid() is not null
    and is_active = true
    and (
      scheduled_publish_at is null
      or scheduled_publish_at <= now()
    )
  );

create policy "Professores podem gerenciar exercícios"
  on public.teacher_exercises
  for all
  to public
  using (is_teacher_admin())
  with check (is_teacher_admin());

-- Restaura papéis e expressões das políticas alteradas.
alter policy "Users can read own activity results"
  on public.activity_results
  to authenticated
  using (auth.uid() = user_id);

alter policy "Users can insert own activity results"
  on public.activity_results
  to authenticated
  with check (auth.uid() = user_id);

alter policy "Alunos podem ver seus exercícios diários"
  on public.daily_exercise_completion
  to public
  using (auth.uid() = user_id);

alter policy "Alunos podem inserir seus exercícios diários"
  on public.daily_exercise_completion
  to public
  with check (auth.uid() = user_id);

alter policy "Alunos podem atualizar seus exercícios diários"
  on public.daily_exercise_completion
  to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter policy "Alunos podem visualizar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  to authenticated
  using (user_id = auth.uid());

alter policy "Alunos podem criar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  to authenticated
  with check (user_id = auth.uid());

alter policy "Alunos podem atualizar suas conclusoes de gramatica"
  on public.grammar_lesson_completion
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter policy "Users can insert own profile"
  on public.profiles
  to authenticated
  with check (auth.uid() = id);

alter policy "Professores podem visualizar matrículas"
  on public.student_enrollments
  to public
  using (
    exists (
      select 1
      from public.teacher_admins ta
      where lower(ta.email) = lower(auth.jwt() ->> 'email')
    )
  );

alter policy "Alunos podem ver sua própria frequência"
  on public.student_frequency
  to public
  using (auth.uid() = user_id);

alter policy "Usuários podem inserir sua própria frequência"
  on public.student_frequency
  to public
  with check (auth.uid() = user_id);

alter policy "Usuários podem atualizar sua própria frequência"
  on public.student_frequency
  to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter policy "Usuários podem apagar sua própria frequência"
  on public.student_frequency
  to public
  using (auth.uid() = user_id);

alter policy "Alunos podem inserir seus próprios dados privados"
  on public.student_private_data
  to public
  with check (auth.uid() = user_id);

alter policy "Alunos podem atualizar seus próprios dados privados"
  on public.student_private_data
  to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
  to public
  using (
    lower(email) = lower(auth.jwt() ->> 'email')
  );

commit;
