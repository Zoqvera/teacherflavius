-- Read-only catalog metadata. Do not select application rows or migration statements.
select json_build_object(
  'tables', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  'constraints', (
    select count(*) from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
  ),
  'non_constraint_indexes', (
    select count(*) from pg_index i
    join pg_class tbl on tbl.oid = i.indrelid
    join pg_namespace n on n.oid = tbl.relnamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_constraint c where c.conindid = i.indexrelid
      )
  ),
  'public_functions', (
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ),
  'private_functions', (
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
  ),
  'rls_policies', (
    select count(*) from pg_policies where schemaname = 'public'
  ),
  'public_user_triggers', (
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  ),
  'application_auth_triggers', (
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and not t.tgisinternal
      and t.tgfoid in (
        select p.oid from pg_proc p
        join pg_namespace pn on pn.oid = p.pronamespace
        where pn.nspname in ('public', 'private')
      )
  ),
  'application_event_triggers', (
    select count(*) from pg_event_trigger e
    where e.evtfoid in (
      select p.oid from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
    )
  ),
  'cron_jobs', (
    select count(*) from cron.job
    where jobname in (
      'sync-auto-makeup-slots-30-days',
      'web-push-notifications'
    )
  ),
  'storage_buckets', (
    select count(*) from storage.buckets
  ),
  'vault_secret_names', (
    select count(*) from vault.secrets
    where name in (
      'teacherflavius_notification_webhook_secret',
      'teacherflavius_web_push_cron_secret',
      'teacherflavius_web_push_vapid_private_key'
    )
  )
);
