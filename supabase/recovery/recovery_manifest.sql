-- Technical recovery fingerprint used by both production backup capture and disposable restore verification.
-- Contains counts/configuration only; it intentionally excludes row contents and secret values.
select jsonb_pretty(jsonb_build_object(
  'format_version', 2,
  'captured_at', now(),
  'critical_row_counts', jsonb_build_object(
    'profiles', (select count(*) from public.profiles),
    'auth_users', (select count(*) from auth.users),
    'auth_identities', (select count(*) from auth.identities),
    'auth_mfa_factors', (select count(*) from auth.mfa_factors),
    'monthly_tuition', (select count(*) from public.monthly_tuition),
    'tuition_payment_attempts', (select count(*) from public.tuition_payment_attempts),
    'makeup_class_slots', (select count(*) from public.makeup_class_slots)
  ),
  'catalog_fingerprint', jsonb_build_object(
    'public_tables', (
      select count(*)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    ),
    'public_constraints', (
      select count(*)
      from pg_constraint co
      join pg_namespace n on n.oid = co.connamespace
      where n.nspname = 'public'
    ),
    'public_non_constraint_indexes', (
      select count(*)
      from pg_index i
      join pg_class tbl on tbl.oid = i.indrelid
      join pg_namespace n on n.oid = tbl.relnamespace
      where n.nspname = 'public'
        and not exists (
          select 1 from pg_constraint co where co.conindid = i.indexrelid
        )
    ),
    'public_functions', (
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    ),
    'private_functions', (
      select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
    ),
    'public_rls_policies', (
      select count(*) from pg_policies where schemaname = 'public'
    ),
    'public_user_triggers', (
      select count(*)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal
    ),
    'application_auth_triggers', (
      select count(*)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth'
        and not t.tgisinternal
        and t.tgfoid in (
          select p.oid
          from pg_proc p
          join pg_namespace pn on pn.oid = p.pronamespace
          where pn.nspname in ('public', 'private')
        )
    ),
    'application_event_triggers', (
      select count(*)
      from pg_event_trigger e
      where e.evtfoid in (
        select p.oid
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
      )
    )
  ),
  'storage', jsonb_build_object(
    'buckets', (select count(*) from storage.buckets),
    'objects', (select count(*) from storage.objects)
  ),
  'cron_jobs', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'jobname', jobname,
        'schedule', schedule,
        'command', command,
        'active', active
      ) order by jobname
    )
    from cron.job
    where jobname in (
      'auth-account-health-check',
      'daily-data-retention-maintenance',
      'mercado-pago-chargeback-reconciliation',
      'mercado-pago-reconciliation',
      'operational-data-quality-health-check',
      'payment-alert-health-scan',
      'payment-financial-health-check',
      'sync-auto-makeup-slots-30-days',
      'system-health-watchdog',
      'system-synthetic-probe'
    )
  ), '[]'::jsonb)
));
