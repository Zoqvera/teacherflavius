-- ETAPA 1C. Object identifiers and SHA256 fingerprints ONLY.
-- Do not export pg_get_functiondef, pg_get_triggerdef, migration statements,
-- application data, role secrets, Vault values or arbitrary SQL source.
-- Read-only metadata, identical on production and disposable CLI databases.
with inventory as (
  select
    'relation'::text as kind,
    n.nspname || '.' || c.relname as object_id,
    format('%s|%s|%s|%s|%s',
      c.relkind, c.relpersistence, c.relrowsecurity,
      c.relforcerowsecurity, coalesce(c.relacl::text, '')) as definition
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p', 'v', 'm')

  union all

  select
    'column',
    n.nspname || '.' || c.relname || '.' || a.attname,
    format('%s|%s|%s|%s|%s|%s',
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      a.attnotnull,
      a.attidentity,
      a.attgenerated,
      coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''),
      a.attcollation::text)
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p', 'v', 'm')
    and a.attnum > 0 and not a.attisdropped

  union all

  select
    'constraint',
    n.nspname || '.' || c.relname || '.' || x.conname,
    pg_catalog.pg_get_constraintdef(x.oid, true)
  from pg_catalog.pg_constraint x
  join pg_catalog.pg_class c on c.oid = x.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')

  union all

  select
    'index',
    n.nspname || '.' || idx.relname,
    pg_catalog.pg_get_indexdef(idx.oid)
  from pg_catalog.pg_index i
  join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = tbl.relnamespace
  where n.nspname in ('public', 'private')
    and not exists (
      select 1 from pg_catalog.pg_constraint x where x.conindid = i.indexrelid
    )

  union all

  select
    'routine',
    n.nspname || '.' || p.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    pg_catalog.pg_get_functiondef(p.oid)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prokind in ('f', 'p')

  union all

  select
    'policy',
    pol.schemaname || '.' || pol.tablename || '.' || pol.policyname,
    format('%s|%s|%s|%s|%s',
      pol.permissive, array_to_string(pol.roles, ','),
      pol.cmd, coalesce(pol.qual, ''), coalesce(pol.with_check, ''))
  from pg_catalog.pg_policies pol
  where pol.schemaname in ('public', 'private')

  union all

  select
    'trigger',
    n.nspname || '.' || c.relname || '.' || t.tgname,
    pg_catalog.pg_get_triggerdef(t.oid)
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and not t.tgisinternal
)
select
  kind,
  object_id,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(definition, 'UTF8')), 'hex')
from inventory
order by kind, object_id;
