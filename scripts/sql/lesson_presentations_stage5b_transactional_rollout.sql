-- ETAPA 5B/5: implanta SOMENTE as duas migrations de apresentações.
-- Deve rodar exclusivamente via psql -X -1 -v ON_ERROR_STOP=1 (transação única).
-- Falha fechada: qualquer divergência desfaz DDL e ledger juntos.
set lock_timeout = '5s';
set statement_timeout = '60s';

select pg_advisory_xact_lock(
  hashtext('teacherflavius'),
  hashtext('lesson_presentations_stage5b')
);

lock table supabase_migrations.schema_migrations
  in share row exclusive mode;

do $preflight$
declare
  migration_count integer;
  migration_tip text;
begin
  select count(*), max(version)
    into migration_count, migration_tip
  from supabase_migrations.schema_migrations;

  if migration_count <> 316 or migration_tip <> '20261017110321' then
    raise exception 'Historical migration baseline has changed. Stop deployment.';
  end if;

  if to_regclass('public.lesson_presentations') is not null
     or to_regclass('public.lesson_presentation_versions') is not null
     or to_regclass('public.lesson_presentation_views') is not null
     or to_regprocedure('private.guard_lesson_presentation_write()') is not null
     or to_regprocedure('private.record_lesson_presentation_version()') is not null then
    raise exception 'Presentation schema already exists or is partially deployed.';
  end if;

  if to_regclass('public.profiles') is null
     or to_regclass('public.study_lesson_pages') is null
     or to_regclass('auth.users') is null
     or to_regprocedure('public.is_teacher_admin()') is null
     or not exists (select 1 from pg_namespace where nspname = 'private') then
    raise exception 'Missing productive prerequisites; deployment stopped.';
  end if;

  if (select format_type(a.atttypid, a.atttypmod)
      from pg_attribute a
      where a.attrelid = 'public.profiles'::regclass and a.attname = 'id') <> 'uuid'
     or (select format_type(a.atttypid, a.atttypmod)
      from pg_attribute a
      where a.attrelid = 'public.study_lesson_pages'::regclass and a.attname = 'id') <> 'uuid' then
    raise exception 'Existing identity column types are incompatible.';
  end if;
end;
$preflight$;

\ir ../../supabase/migrations/20261017133000_lesson_presentations_stage1.sql
\ir ../../supabase/migrations/20261017144500_lesson_presentation_views_stage3.sql

-- Ledger identifiers coincide EXACTLY with the versioned repository filenames.
-- They are written in the same transaction as the corresponding DDL.
insert into supabase_migrations.schema_migrations (version, name)
values
  ('20261017133000', 'lesson_presentations_stage1'),
  ('20261017144500', 'lesson_presentation_views_stage3');

do $verify$
declare
  actual_policies integer;
  actual_triggers integer;
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 318
     or (select max(version) from supabase_migrations.schema_migrations) <> '20261017144500' then
    raise exception 'Unexpected ledger after presentation migrations.';
  end if;

  select count(*) into actual_policies
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'lesson_presentations',
      'lesson_presentation_versions',
      'lesson_presentation_views'
    );
  if actual_policies <> 6 then
    raise exception 'Expected exactly six RLS policies, found %.', actual_policies;
  end if;

  if exists (
    select 1 from pg_class c
    where c.oid in (
      'public.lesson_presentations'::regclass,
      'public.lesson_presentation_versions'::regclass,
      'public.lesson_presentation_views'::regclass
    ) and not c.relrowsecurity
  ) then
    raise exception 'RLS not enabled on all presentation tables.';
  end if;

  select count(*) into actual_triggers
  from pg_trigger t
  where t.tgrelid = 'public.lesson_presentations'::regclass
    and not t.tgisinternal;
  if actual_triggers <> 2 then
    raise exception 'Expected two presentation revision triggers.';
  end if;

  if has_table_privilege('anon', 'public.lesson_presentations', 'SELECT')
     or has_table_privilege('anon', 'public.lesson_presentation_versions', 'SELECT')
     or has_table_privilege('anon', 'public.lesson_presentation_views', 'SELECT')
     or has_table_privilege('authenticated', 'public.lesson_presentation_versions', 'INSERT')
     or has_table_privilege('authenticated', 'public.lesson_presentation_views', 'UPDATE')
     or has_table_privilege('authenticated', 'public.lesson_presentation_views', 'DELETE')
     or has_column_privilege('authenticated', 'public.lesson_presentation_views', 'viewed_at', 'INSERT') then
    raise exception 'Unsafe presentation permissions detected.';
  end if;

  if (select count(*) from public.lesson_presentations) <> 0
     or (select count(*) from public.lesson_presentation_versions) <> 0
     or (select count(*) from public.lesson_presentation_views) <> 0 then
    raise exception 'New presentation tables must be empty at rollout.';
  end if;
end;
$verify$;

select 'PRESENTATION_SCHEMA_STAGE5B_COMMITTED' as status;
