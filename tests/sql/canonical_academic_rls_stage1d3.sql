-- Stage 1D.3: assertions only, for the isolated canonical reconstruction.
-- No production writes, synthetic fixtures, or secret material.
do $academic_rls$
declare
  student_page_count integer;
  teacher_page_count integer;
begin
  if to_regclass('public.homework_relationship_events') is null then
    raise exception 'Academic relationship event table is missing';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.homework_relationship_events'::regclass
      and relrowsecurity
  ) then
    raise exception 'Academic relationship event storage must have RLS';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'homework_relationship_events'
  ) then
    raise exception 'Academic relationship events must not expose client policies';
  end if;

  if has_table_privilege('anon','public.homework_relationship_events','SELECT')
    or has_table_privilege('authenticated','public.homework_relationship_events','SELECT')
    or has_table_privilege('authenticated','public.homework_relationship_events','INSERT')
    or has_table_privilege('anon','public.homework_relationship_events','UPDATE')
    or has_sequence_privilege('authenticated',
      'public.homework_relationship_events_id_seq','USAGE')
    or has_sequence_privilege('anon',
      'public.homework_relationship_events_id_seq','SELECT') then
    raise exception 'Academic relationship event history is exposed to browsers';
  end if;

  if not has_table_privilege('service_role',
      'public.homework_relationship_events','SELECT')
    or not has_table_privilege('service_role',
      'public.homework_relationship_events','INSERT')
    or not has_sequence_privilege('service_role',
      'public.homework_relationship_events_id_seq','USAGE') then
    raise exception 'Service role cannot use academic event storage';
  end if;

  if to_regclass('public.homework_relationship_events_student_latest_idx') is null then
    raise exception 'Missing academic event lookup index';
  end if;

  select count(*) into student_page_count
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'study_lesson_pages'
    and p.policyname = 'Alunos podem ver páginas de lição vinculadas'
    and p.cmd = 'SELECT'
    and p.roles = array['authenticated']::name[]
    and p.qual like '%is_teacher_admin_mfa%';

  select count(*) into teacher_page_count
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'study_lesson_pages'
    and p.policyname in (
      'Professor pode criar páginas de lição',
      'Professor pode atualizar páginas de lição',
      'Professor pode excluir páginas de lição'
    )
    and p.roles = array['authenticated']::name[]
    and (
      (p.cmd = 'INSERT'
        and p.with_check like '%is_teacher_admin_mfa%')
      or (p.cmd = 'UPDATE'
        and p.qual like '%is_teacher_admin_mfa%'
        and p.with_check like '%is_teacher_admin_mfa%')
      or (p.cmd = 'DELETE'
        and p.qual like '%is_teacher_admin_mfa%')
    );

  if student_page_count <> 1 or teacher_page_count <> 3 then
    raise exception 'Canonical lesson page teacher MFA policy invariant failed';
  end if;
end;
$academic_rls$;
