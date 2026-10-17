-- Consulta de prontidao para o pacote de apresentacoes. SOMENTE LEITURA.
-- Nao retornar dados de alunos, corpo de funcoes, secretos ou URLs.
select jsonb_build_object(
  'ledger_count', (select count(*) from supabase_migrations.schema_migrations),
  'ledger_tip', (select max(version)::text from supabase_migrations.schema_migrations),
  'stage1_migration_registered', exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261017133000'
  ),
  'stage3_migration_registered', exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261017144500'
  ),
  'presentations_table_exists',
    to_regclass('public.lesson_presentations') is not null,
  'versions_table_exists',
    to_regclass('public.lesson_presentation_versions') is not null,
  'views_table_exists',
    to_regclass('public.lesson_presentation_views') is not null,
  'profiles_table_exists', to_regclass('public.profiles') is not null,
  'lesson_pages_table_exists',
    to_regclass('public.study_lesson_pages') is not null,
  'teacher_admin_helper_exists',
    to_regprocedure('public.is_teacher_admin()') is not null,
  'production_data_examined', false,
  'production_write_authorized', false
) as presentation_preflight;
