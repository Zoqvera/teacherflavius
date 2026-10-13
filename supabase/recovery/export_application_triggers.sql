-- Export application-owned triggers that the Supabase CLI excludes from managed schemas.
-- The generated statements belong inside the encrypted backup, never in the public repo.
-- Force schema qualification in pg_get_triggerdef to make restoration independent
-- of the source database's search_path.
set search_path = pg_catalog;

with application_auth_triggers as (
  select
    t.oid,
    t.tgname,
    t.tgenabled,
    c.relname,
    n.nspname as table_schema
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where n.nspname = 'auth'
    and not t.tgisinternal
    and pn.nspname in ('public', 'private')
),
statements as (
  select
    1 as position,
    tgname as object_name,
    pg_get_triggerdef(oid, false) || ';' ||
      case tgenabled
        when 'D' then E'\n' || format('ALTER TABLE %I.%I DISABLE TRIGGER %I;', table_schema, relname, tgname)
        when 'R' then E'\n' || format('ALTER TABLE %I.%I ENABLE REPLICA TRIGGER %I;', table_schema, relname, tgname)
        when 'A' then E'\n' || format('ALTER TABLE %I.%I ENABLE ALWAYS TRIGGER %I;', table_schema, relname, tgname)
        else ''
      end as ddl
  from application_auth_triggers

  union all

  select
    2,
    e.evtname,
    format(
      'CREATE EVENT TRIGGER %I ON %s%s EXECUTE FUNCTION %I.%I();',
      e.evtname,
      e.evtevent,
      case
        when cardinality(e.evttags) > 0 then format(
          ' WHEN TAG IN (%s)',
          (select string_agg(quote_literal(tag), ', ' order by tag)
           from unnest(e.evttags) as tag)
        )
        else ''
      end,
      n.nspname,
      p.proname
    ) ||
      case e.evtenabled
        when 'D' then E'\n' || format('ALTER EVENT TRIGGER %I DISABLE;', e.evtname)
        when 'R' then E'\n' || format('ALTER EVENT TRIGGER %I ENABLE REPLICA;', e.evtname)
        when 'A' then E'\n' || format('ALTER EVENT TRIGGER %I ENABLE ALWAYS;', e.evtname)
        else ''
      end
  from pg_event_trigger e
  join pg_proc p on p.oid = e.evtfoid
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
)
select ddl
from statements
order by position, object_name;
