-- Export only the application's reviewed presentation ACLs.
-- Read-only query executed against production. The generated statements
-- are encrypted with the backup and replayed ONLY in the disposable restore.
-- PostgreSQL / Supabase local defaults may grant broader privileges on
-- newly recreated tables than the production application migrations allow.
with protected_tables as (
  select c.oid, c.relname, c.relacl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'lesson_presentations',
      'lesson_presentation_versions',
      'lesson_presentation_views'
    )
    and c.relkind = 'r'
),
statements as (
  select 1 as stage, p.relname, 0 as attnum,
    format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated;',
      p.relname
    ) as sql
  from protected_tables p

  union all

  select 2, p.relname, 0,
    format(
      'GRANT %s ON TABLE public.%I TO %I;',
      string_agg(distinct upper(acl.privilege_type), ', '
        order by upper(acl.privilege_type)),
      p.relname, roles.rolname
    )
  from protected_tables p
  cross join lateral pg_catalog.aclexplode(p.relacl) acl
  join pg_catalog.pg_roles roles on roles.oid = acl.grantee
  where roles.rolname in ('authenticated', 'anon')
  group by p.relname, roles.rolname

  union all

  select 3, p.relname, a.attnum,
    format(
      'GRANT %s (%I) ON TABLE public.%I TO %I;',
      upper(acl.privilege_type),
      a.attname, p.relname, roles.rolname
    )
  from protected_tables p
  join pg_catalog.pg_attribute a on a.attrelid = p.oid
    and a.attnum > 0 and not a.attisdropped
  cross join lateral pg_catalog.aclexplode(a.attacl) acl
  join pg_catalog.pg_roles roles on roles.oid = acl.grantee
  where roles.rolname in ('authenticated', 'anon')
)
select sql
from statements
order by stage, relname, attnum, sql;
