-- Stage 7.3.4: administrative release artifact, never a migration.
-- Running without an explicit transaction-local approval signal fails closed.
-- This script ONLY installs a DISABLED daily pg_cron job.
-- 06:20 UTC corresponds to 03:20 in Sao Paulo (America/Sao_Paulo).
-- Production activation is separately authorized and manually executed.
do $retention_schedule$
declare
  cron_job integer;
  configured record;
begin
  if current_setting('app.resend_retention_schedule_approved', true)
     is distinct from 'true' then
    raise exception 'Resend retention schedule requires explicit release approval';
  end if;

  if to_regprocedure('public.prune_resend_delivery_evidence(integer)') is null
     or to_regclass('private.resend_delivery_events') is null
     or to_regclass('private.resend_delivery_messages') is null then
    raise exception 'Resend tracking and retention migration is not installed';
  end if;

  select jobid, schedule, command, active
    into configured
    from cron.job
   where jobname = 'resend-delivery-evidence-retention'
   limit 1;

  if found then
    if configured.schedule <> '20 6 * * *'
       or configured.command <> 'select public.prune_resend_delivery_evidence(500);' then
      raise exception 'Existing Resend retention job differs from approved specification';
    end if;
    -- Scheduling script never activates or toggles an existing job.
    return;
  end if;

  select cron.schedule(
    'resend-delivery-evidence-retention',
    '20 6 * * *',
    'select public.prune_resend_delivery_evidence(500);'
  ) into cron_job;
  perform cron.alter_job(cron_job, active := false);

  if not exists (
    select 1 from cron.job
    where jobid = cron_job
      and jobname = 'resend-delivery-evidence-retention'
      and active = false
  ) then
    raise exception 'Resend retention job was not installed as disabled';
  end if;
end;
$retention_schedule$;
