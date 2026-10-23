-- Etapa 5A: verificações somente no backup restaurado em Supabase descartável.
-- Este arquivo é concatenado entre BEGIN e ROLLBACK após as migrações 1 e 3.
-- Nenhum aluno, Auth ou dado financeiro é consultado.
do $presentation_restore_rehearsal$
declare
  table_name text;
  policy_count integer;
  trigger_count integer;
begin
  foreach table_name in array array[
    'lesson_presentations',
    'lesson_presentation_versions',
    'lesson_presentation_views'
  ]
  loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'Tabela esperada ausente no ensaio: %', table_name;
    end if;

    if not (
      select c.relrowsecurity
      from pg_catalog.pg_class c
      where c.oid = to_regclass('public.' || table_name)
    ) then
      raise exception 'RLS desabilitado no ensaio: %', table_name;
    end if;

    if has_table_privilege('anon', 'public.' || table_name, 'SELECT')
      or has_table_privilege('anon', 'public.' || table_name, 'INSERT')
      or has_table_privilege('anon', 'public.' || table_name, 'UPDATE')
      or has_table_privilege('anon', 'public.' || table_name, 'DELETE') then
      raise exception 'Privilégios anônimos inesperados no ensaio: %', table_name;
    end if;
  end loop;

  select count(*) into policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in (
      'lesson_presentations',
      'lesson_presentation_versions',
      'lesson_presentation_views'
    );
  if policy_count <> 6 then
    raise exception 'Esperadas seis políticas RLS, foram encontradas %.', policy_count;
  end if;

  select count(*) into trigger_count
  from pg_catalog.pg_trigger
  where tgrelid = 'public.lesson_presentations'::regclass
    and not tgisinternal
    and tgname in (
      'guard_lesson_presentation_write',
      'record_lesson_presentation_version'
    );
  if trigger_count <> 2 then
    raise exception 'Gatilhos das apresentações incompletos.';
  end if;

  if has_table_privilege('authenticated', 'public.lesson_presentation_views', 'UPDATE')
    or has_table_privilege('authenticated', 'public.lesson_presentation_views', 'DELETE')
    or has_column_privilege(
      'authenticated', 'public.lesson_presentation_views', 'viewed_at', 'INSERT'
    ) then
    raise exception 'Os recibos permitem alteração de dados de auditoria.';
  end if;

  if not (
      has_column_privilege('authenticated', 'public.lesson_presentation_views',
        'presentation_id', 'INSERT')
      and has_column_privilege('authenticated', 'public.lesson_presentation_views',
        'revision_number', 'INSERT')
      and has_column_privilege('authenticated', 'public.lesson_presentation_views',
        'teacher_id', 'INSERT')
    ) then
    raise exception 'Permissões de inserção do recibo incompletas.';
  end if;

  if has_function_privilege('anon',
      'private.record_lesson_presentation_version()', 'EXECUTE')
    or has_function_privilege('authenticated',
      'private.record_lesson_presentation_version()', 'EXECUTE')
    or has_function_privilege('anon',
      'private.guard_lesson_presentation_write()', 'EXECUTE') then
    raise exception 'Funções internas das apresentações acessíveis pelo cliente.';
  end if;

  -- Only newly created tables must be empty. Restored production tables
  -- retain their legitimate records, whose counts the recovery manifest checks.
  if current_setting('teacherflavius.recovery_expect_empty_presentation_tables', true) = 'on'
     and (
       (select count(*) from public.lesson_presentations) <> 0
       or (select count(*) from public.lesson_presentation_versions) <> 0
       or (select count(*) from public.lesson_presentation_views) <> 0
     ) then
    raise exception 'Ensaio de DDL gerou registros inesperados.';
  end if;
end;
$presentation_restore_rehearsal$;

select 'LESSON_PRESENTATIONS_STAGE5_BACKUP_REHEARSAL_PASSED' as verdict;
