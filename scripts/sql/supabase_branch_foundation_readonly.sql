-- Only counts of historical DDL declarations are returned.
-- Never select migration statements, application rows, or private records.
-- This is a detection heuristic, not proof that a migration can be replayed.
select json_build_object(
  'migration_count', count(*),
  'profiles_creates', count(*) filter (
    where array_to_string(statements, ' ') ~*
      'create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?("?public"?[.])?"?profiles"?[[:space:](]'
  ),
  'teacher_admins_creates', count(*) filter (
    where array_to_string(statements, ' ') ~*
      'create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?("?public"?[.])?"?teacher_admins"?[[:space:](]'
  ),
  'study_lesson_pages_creates', count(*) filter (
    where array_to_string(statements, ' ') ~*
      'create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?("?public"?[.])?"?study_lesson_pages"?[[:space:](]'
  )
)
from supabase_migrations.schema_migrations;
