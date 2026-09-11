-- Database-backed Supabase platform configuration not represented by the public schema dump.
-- Safe to run after the application schema has been restored.

-- Required extension used by application-owned automation.
create extension if not exists pg_cron with schema pg_catalog;

-- Recreate every application-owned Cron job idempotently. Commands contain no secrets;
-- dispatch functions read environment-specific secrets from Vault at execution time.
do $$
declare
  target record;
begin
  for target in
    select *
    from (
      values
        ('auth-account-health-check', '22,52 * * * *', 'select private.run_auth_account_health_check(true);'),
        ('daily-data-retention-maintenance', '35 5 * * *', 'select public.perform_data_retention_maintenance(''cron'');'),
        ('mercado-pago-chargeback-reconciliation', '17,47 * * * *', 'select private.dispatch_mercado_pago_chargeback_reconciliation();'),
        ('mercado-pago-reconciliation', '*/5 * * * *', 'select private.dispatch_mercado_pago_reconciliation();'),
        ('operational-data-quality-health-check', '12,42 * * * *', 'select private.run_operational_data_quality_check(true);'),
        ('payment-alert-health-scan', '*/5 * * * *', 'select private.scan_payment_alert_conditions();'),
        ('payment-financial-health-check', '3,8,13,18,23,28,33,38,43,48,53,58 * * * *', 'select private.run_payment_financial_health_check(true);'),
        ('sync-auto-makeup-slots-30-days', '15 6 * * *', 'select public.sync_auto_makeup_slots_30_days();'),
        ('system-health-watchdog', '4,14,24,34,44,54 * * * *', 'select private.system_health_watchdog();'),
        ('system-synthetic-probe', '1-59/5 * * * *', 'select private.dispatch_system_synthetic_probe();')
    ) as configured(jobname, schedule, command)
  loop
    if not exists (
      select 1
      from cron.job
      where jobname = target.jobname
    ) then
      perform cron.schedule(target.jobname, target.schedule, target.command);
    end if;
  end loop;
end;
$$;

-- Vault values are intentionally NOT versioned. A restored environment must provision
-- the secrets used by notification/payment dispatch functions before Cron automation is
-- allowed to run against real external services.
-- Required names currently include:
--   teacherflavius_notification_webhook_secret

-- Current production inventory at recovery-baseline time:
-- Application-owned Cron jobs: 10.
-- Storage buckets: none.
-- Custom storage RLS policies: none.
