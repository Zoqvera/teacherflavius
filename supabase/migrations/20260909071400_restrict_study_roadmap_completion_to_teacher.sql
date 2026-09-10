drop policy if exists "Alunos podem inserir suas lições do roteiro" on public.study_roadmap_completion;
drop policy if exists "Alunos podem atualizar suas lições do roteiro" on public.study_roadmap_completion;

drop policy if exists "Professor pode inserir progresso do roteiro" on public.study_roadmap_completion;
create policy "Professor pode inserir progresso do roteiro"
  on public.study_roadmap_completion
  for insert
  to authenticated
  with check ((select public.is_teacher_admin()));

drop policy if exists "Professor pode atualizar progresso do roteiro" on public.study_roadmap_completion;
create policy "Professor pode atualizar progresso do roteiro"
  on public.study_roadmap_completion
  for update
  to authenticated
  using ((select public.is_teacher_admin()))
  with check ((select public.is_teacher_admin()));

drop policy if exists "Professor pode excluir progresso do roteiro" on public.study_roadmap_completion;
create policy "Professor pode excluir progresso do roteiro"
  on public.study_roadmap_completion
  for delete
  to authenticated
  using ((select public.is_teacher_admin()));
