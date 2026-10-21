-- Stage 1D.4B: disposable canonical PostgreSQL policy checks (no row data).
do $academic_teacher_policy_checks$
declare
  row_item record;
  expected_count integer;
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid='public.study_roadmap_completion'::regclass
      and c.relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid='public.teacher_exercises'::regclass
      and c.relrowsecurity
  ) then
    raise exception 'RLS is required for recovered academic tables';
  end if;

  for row_item in
    select * from (
      values
        ('study_roadmap_completion','Professor pode inserir progresso do roteiro','INSERT'),
        ('study_roadmap_completion','Professor pode atualizar progresso do roteiro','UPDATE'),
        ('study_roadmap_completion','Professor pode excluir progresso do roteiro','DELETE'),
        ('teacher_exercises','Apenas professores podem visualizar exercícios durante suspens','SELECT')
    ) as expected(tablename, policyname, command_name)
  loop
    if not exists (
      select 1 from pg_catalog.pg_policies p
      where p.schemaname='public'
        and p.tablename=row_item.tablename
        and p.policyname=row_item.policyname
        and p.cmd=row_item.command_name
        and p.permissive='PERMISSIVE'
        and p.roles=array['authenticated']::name[]
        and (
          (p.cmd='INSERT'
            and p.qual is null
            and p.with_check like '%is_teacher_admin()%')
          or (p.cmd='UPDATE'
            and p.qual like '%is_teacher_admin()%'
            and p.with_check like '%is_teacher_admin()%')
          or (p.cmd in ('SELECT','DELETE')
            and p.qual like '%is_teacher_admin()%'
            and p.with_check is null)
        )
    ) then
      raise exception 'Missing/mismatched reviewed teacher policy %', row_item.policyname;
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname='public' and p.tablename='study_roadmap_completion'
      and p.policyname like 'Alunos podem %'
      and p.cmd in ('INSERT','UPDATE','DELETE','ALL')
  ) then
    raise exception 'Students must not modify academic roadmap through direct RLS';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname='public' and p.tablename='teacher_exercises'
      and p.cmd='SELECT' and p.qual not like '%is_teacher_admin()%'
  ) then
    raise exception 'Exercise portal must remain teacher-only during suspension';
  end if;

  select count(*) into expected_count from pg_catalog.pg_policies
  where schemaname='public' and tablename='study_roadmap_completion';
  if expected_count<>5 then raise exception 'Unexpected study roadmap policy count'; end if;

  select count(*) into expected_count from pg_catalog.pg_policies
  where schemaname='public' and tablename='teacher_exercises';
  if expected_count<>4 then raise exception 'Unexpected suspended exercise policy count'; end if;
end;
$academic_teacher_policy_checks$;
