-- Validate unrelated lesson-page MFA and RLS in an isolated restoration.
do $lesson_page_mfa$
declare
  student_page_count integer;
  teacher_page_count integer;
begin
  if (select count(*) from pg_policies
      where schemaname in ('public', 'private') and permissive = 'RESTRICTIVE') <> 0 then
    raise exception 'Restored schema still contains unintended restrictive policies';
  end if;

  if (select count(*) from pg_policies
      where schemaname in ('public', 'private')) <> 95 then
    raise exception 'Restored schema has an unexpected number of RLS policies';
  end if;

  if has_table_privilege('anon','public.study_lesson_pages','SELECT') then
    raise exception 'Unauthenticated users can access lesson pages';
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
$lesson_page_mfa$;
