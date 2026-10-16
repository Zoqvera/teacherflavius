-- Called only inside a disposable Postgres BEGIN/ROLLBACK.
-- The schedule script has already created one DISABLED job.
\set ON_ERROR_STOP on

do $verify_resend_cron$
declare
  jobs integer;
  configured record;
begin
  select count(*)::integer into jobs
    from cron.job
   where jobname = 'resend-delivery-evidence-retention';

  if jobs <> 1 then
    raise exception 'Expected one idempotently scheduled retention job; found %', jobs;
  end if;

  select schedule, command, active into configured
    from cron.job
   where jobname = 'resend-delivery-evidence-retention';

  if configured.schedule <> '20 6 * * *'
     or configured.command <> 'select public.prune_resend_delivery_evidence(500);'
     or configured.active is distinct from false then
    raise exception 'Retention schedule differs or was prematurely activated';
  end if;
end;
$verify_resend_cron$;
