-- Etapa 5C: as duas migrations produtivas foram executadas em uma
-- transacao psql, com SQL historico no repositório, mas sem statements
-- replicados ao ledger. Esta consulta SOMENTE LEITURA atesta o catálogo,
-- sem tocar no conteudo de apresentacoes nem em contas de alunos.
-- A saida aceita e unicamente 't'.
select (
  (select count(*) = 2
   from supabase_migrations.schema_migrations
   where (version = '20261017133000' and name = 'lesson_presentations_stage1')
      or (version = '20261017144500' and name = 'lesson_presentation_views_stage3')
  )
  and (select count(*) = 2
       from supabase_migrations.schema_migrations
       where version in ('20261017133000', '20261017144500')
         and coalesce(cardinality(statements), 0) = 0)
  and to_regclass('public.lesson_presentations') is not null
  and to_regclass('public.lesson_presentation_versions') is not null
  and to_regclass('public.lesson_presentation_views') is not null
  and (select count(*) = 3
       from pg_class
       where oid in (
         'public.lesson_presentations'::regclass,
         'public.lesson_presentation_versions'::regclass,
         'public.lesson_presentation_views'::regclass
       )
       and relrowsecurity)
  and (select count(*) = 6
       from pg_policies
       where schemaname = 'public'
         and tablename in (
           'lesson_presentations',
           'lesson_presentation_versions',
           'lesson_presentation_views'
         )
         and roles = array['authenticated']::name[])
  and (select count(*) = 2
       from pg_trigger
       where tgrelid = 'public.lesson_presentations'::regclass
         and tgname in (
           'guard_lesson_presentation_write',
           'record_lesson_presentation_version'
         ) and not tgisinternal)
  and to_regprocedure('public.is_teacher_admin()') is not null
  and to_regprocedure('private.guard_lesson_presentation_write()') is not null
  and to_regprocedure('private.record_lesson_presentation_version()') is not null
  and not has_function_privilege('anon', 'public.is_teacher_admin()', 'EXECUTE')
  and not has_function_privilege(
    'authenticated', 'private.record_lesson_presentation_version()', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'private.guard_lesson_presentation_write()', 'EXECUTE'
  )
  and not has_table_privilege('anon', 'public.lesson_presentations', 'SELECT')
  and not has_table_privilege('anon', 'public.lesson_presentation_versions', 'SELECT')
  and not has_table_privilege('anon', 'public.lesson_presentation_views', 'SELECT')
  and has_table_privilege('authenticated', 'public.lesson_presentations', 'SELECT')
  and has_table_privilege('authenticated', 'public.lesson_presentations', 'INSERT')
  and has_table_privilege('authenticated', 'public.lesson_presentations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.lesson_presentations', 'DELETE')
  and has_table_privilege('authenticated', 'public.lesson_presentation_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.lesson_presentation_versions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.lesson_presentation_versions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.lesson_presentation_versions', 'DELETE')
  and has_table_privilege('authenticated', 'public.lesson_presentation_views', 'SELECT')
  and has_column_privilege(
    'authenticated', 'public.lesson_presentation_views', 'teacher_id', 'INSERT'
  )
  and not has_column_privilege(
    'authenticated', 'public.lesson_presentation_views', 'viewed_at', 'INSERT'
  )
  and not has_table_privilege('authenticated', 'public.lesson_presentation_views', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.lesson_presentation_views', 'DELETE')
) as attested;
