-- Keep the existing critical financial invariants; only a complete, checked
-- allocation may explain the difference between provider and monthly amounts.
create or replace function private.run_payment_financial_health_check(target_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  started_at_value timestamptz := clock_timestamp();
  completed_at_value timestamptz;
  duration_ms_value integer := 0;
  checks_value jsonb := '{}'::jsonb;
  issue_codes_value text[] := '{}'::text[];
  critical_keys text[] := array[
    'approved_without_application',
    'reversal_pending',
    'multiple_approved_per_tuition',
    'applied_tuition_mismatch',
    'rejected_but_applied',
    'refund_inconsistencies',
    'chargeback_inconsistencies',
    'duplicate_provider_payment_ids',
    'duplicate_idempotency_keys',
    'stale_webhook_processing',
    'overdue_chargeback_documentation'
  ];
  warning_keys text[] := array[
    'stale_pending_attempts',
    'failed_webhooks_24h',
    'failed_alerts',
    'refund_attention',
    'open_chargebacks_with_error',
    'reconciliation_failures',
    'reconciliation_stalled',
    'gateway_failures_24h',
    'invalid_webhooks_24h',
    'reconciliation_cron_unhealthy',
    'alert_scan_cron_unhealthy',
    'chargeback_cron_unhealthy',
    'health_cron_inactive'
  ];
  issue_key text;
  warning_count_value integer := 0;
  critical_count_value integer := 0;
  status_value text := 'healthy';
  run_id_value uuid;
  previous_status text;
  previous_issue_codes text[];
  last_reconciliation_success timestamptz;
  last_reconciliation_cron_success timestamptz;
  last_alert_scan_cron_success timestamptz;
  last_chargeback_cron_success timestamptz;
  transition_detected boolean := false;
  error_message text;
begin
  select max(run.completed_at)
    into last_reconciliation_success
  from public.payment_reconciliation_runs run
  where run.status = 'succeeded';

  select max(details.end_time)
    into last_reconciliation_cron_success
  from cron.job_run_details details
  join cron.job job on job.jobid = details.jobid
  where job.jobname = 'mercado-pago-reconciliation'
    and details.status = 'succeeded';

  select max(details.end_time)
    into last_alert_scan_cron_success
  from cron.job_run_details details
  join cron.job job on job.jobid = details.jobid
  where job.jobname = 'payment-alert-health-scan'
    and details.status = 'succeeded';

  select max(details.end_time)
    into last_chargeback_cron_success
  from cron.job_run_details details
  join cron.job job on job.jobid = details.jobid
  where job.jobname = 'mercado-pago-chargeback-reconciliation'
    and details.status = 'succeeded';

  select pg_catalog.jsonb_build_object(
    'approved_without_application', (
      select count(*)::integer
      from public.tuition_payment_attempts attempt
      where attempt.status = 'approved' and attempt.applied_at is null
    ),
    'reversal_pending', (
      select count(*)::integer
      from public.tuition_payment_attempts attempt
      where attempt.status in ('cancelled','refunded','charged_back')
        and attempt.applied_at is not null
        and attempt.reversed_at is null
    ),
    'multiple_approved_per_tuition', (
      select count(*)::integer
      from (
        select attempt.tuition_id
        from public.tuition_payment_attempts attempt
        where attempt.status = 'approved'
          and attempt.applied_at is not null
          and attempt.reversed_at is null
        group by attempt.tuition_id
        having count(*) > 1
      ) duplicates
    ),
    'applied_tuition_mismatch', (
      select count(*)::integer
      from public.tuition_payment_attempts attempt
      join public.monthly_tuition tuition on tuition.id = attempt.tuition_id
      where attempt.status = 'approved'
        and attempt.applied_at is not null
        and attempt.reversed_at is null
        and (
          tuition.payment_date is null
          or tuition.payment_provider is distinct from 'mercado_pago'
          or tuition.provider_payment_id is distinct from attempt.provider_payment_id
          or (
            round(coalesce(tuition.amount_paid, 0), 2) is distinct from round(attempt.amount, 2)
            and not private.has_valid_mercado_pago_split(attempt.id)
          )
          or tuition.payment_method is distinct from attempt.payment_method
        )
    ),
    'rejected_but_applied', (
      select count(*)::integer
      from public.tuition_payment_attempts attempt
      where attempt.status = 'rejected' and attempt.applied_at is not null
    ),
    'refund_inconsistencies', (
      select count(*)::integer
      from public.payment_refund_requests refund
      join public.tuition_payment_attempts attempt on attempt.id = refund.attempt_id
      join public.monthly_tuition tuition on tuition.id = refund.tuition_id
      where refund.status = 'synchronized'
        and (
          attempt.status not in ('refunded','charged_back','cancelled')
          or attempt.reversed_at is null
          or tuition.payment_date is not null
          or tuition.payment_provider is not null
          or tuition.provider_payment_id is not null
          or tuition.amount_paid is not null
        )
    ),
    'chargeback_inconsistencies', (
      select count(*)::integer
      from public.payment_chargebacks chargeback
      join public.tuition_payment_attempts attempt on attempt.id = chargeback.attempt_id
      where chargeback.provider_payment_id is distinct from attempt.provider_payment_id
        or (chargeback.operational_status = 'lost' and attempt.reversed_at is null)
        or (chargeback.operational_status = 'won' and attempt.status = 'approved' and attempt.reversed_at is not null)
    ),
    'duplicate_provider_payment_ids', (
      select count(*)::integer
      from (
        select attempt.provider, attempt.provider_payment_id
        from public.tuition_payment_attempts attempt
        where attempt.provider_payment_id is not null
        group by attempt.provider, attempt.provider_payment_id
        having count(*) > 1
      ) duplicates
    ),
    'duplicate_idempotency_keys', (
      select count(*)::integer
      from (
        select attempt.idempotency_key
        from public.tuition_payment_attempts attempt
        group by attempt.idempotency_key
        having count(*) > 1
      ) duplicates
    ),
    'stale_webhook_processing', (
      select count(*)::integer
      from public.payment_webhook_events event
      where event.status = 'processing'
        and event.last_processing_started_at < now() - interval '5 minutes'
    ),
    'overdue_chargeback_documentation', (
      select count(*)::integer
      from public.payment_chargebacks chargeback
      left join public.payment_chargeback_documentation_cases documentation
        on documentation.chargeback_id = chargeback.id
      where chargeback.operational_status = 'open'
        and chargeback.documentation_status = 'pending'
        and chargeback.documentation_deadline is not null
        and chargeback.documentation_deadline < now()
        and coalesce(documentation.preparation_status, 'not_started') not in ('submitted','closed')
    ),
    'stale_pending_attempts', (
      select count(*)::integer
      from public.tuition_payment_attempts attempt
      where attempt.status in ('created','pending','authorized','in_process','in_mediation')
        and attempt.updated_at < now() - interval '24 hours'
    ),
    'failed_webhooks_24h', (
      select count(*)::integer
      from public.payment_webhook_events event
      where event.status = 'failed'
        and event.updated_at >= now() - interval '24 hours'
    ),
    'failed_alerts', (
      select count(*)::integer
      from public.payment_alert_notifications alert
      where alert.status = 'failed'
    ),
    'refund_attention', (
      select count(*)::integer
      from public.payment_refund_requests refund
      where refund.status = 'failed'
         or (refund.status = 'processing' and refund.started_at < now() - interval '10 minutes')
         or (refund.status = 'provider_accepted' and refund.updated_at < now() - interval '30 minutes')
    ),
    'open_chargebacks_with_error', (
      select count(*)::integer
      from public.payment_chargebacks chargeback
      where chargeback.operational_status = 'open' and chargeback.last_error is not null
    ),
    'reconciliation_failures', (
      select count(*)::integer
      from public.tuition_payment_attempts attempt
      where attempt.reconciliation_failure_count > 0
    ),
    'reconciliation_stalled', case
      when last_reconciliation_success is null or last_reconciliation_success < now() - interval '15 minutes' then 1
      else 0
    end,
    'gateway_failures_24h', (
      select count(*)::integer
      from public.payment_operational_events event
      where event.event_type = 'gateway_failure'
        and event.created_at >= now() - interval '24 hours'
    ),
    'invalid_webhooks_24h', (
      select count(*)::integer
      from public.payment_operational_events event
      where event.event_type = 'invalid_webhook_signature'
        and event.created_at >= now() - interval '24 hours'
    ),
    'reconciliation_cron_unhealthy', case
      when not exists (
        select 1 from cron.job job
        where job.jobname = 'mercado-pago-reconciliation' and job.active
      ) or last_reconciliation_cron_success is null
        or last_reconciliation_cron_success < now() - interval '15 minutes'
      then 1 else 0
    end,
    'alert_scan_cron_unhealthy', case
      when not exists (
        select 1 from cron.job job
        where job.jobname = 'payment-alert-health-scan' and job.active
      ) or last_alert_scan_cron_success is null
        or last_alert_scan_cron_success < now() - interval '15 minutes'
      then 1 else 0
    end,
    'chargeback_cron_unhealthy', case
      when not exists (
        select 1 from cron.job job
        where job.jobname = 'mercado-pago-chargeback-reconciliation' and job.active
      ) or last_chargeback_cron_success is null
        or last_chargeback_cron_success < now() - interval '75 minutes'
      then 1 else 0
    end,
    'health_cron_inactive', case
      when not exists (
        select 1 from cron.job job
        where job.jobname = 'payment-financial-health-check' and job.active
      ) then 1 else 0
    end
  ) into checks_value;

  foreach issue_key in array critical_keys loop
    if coalesce((checks_value ->> issue_key)::integer, 0) > 0 then
      critical_count_value := critical_count_value + 1;
      issue_codes_value := array_append(issue_codes_value, issue_key);
    end if;
  end loop;

  foreach issue_key in array warning_keys loop
    if coalesce((checks_value ->> issue_key)::integer, 0) > 0 then
      warning_count_value := warning_count_value + 1;
      issue_codes_value := array_append(issue_codes_value, issue_key);
    end if;
  end loop;

  if critical_count_value > 0 then
    status_value := 'critical';
  elsif warning_count_value > 0 then
    status_value := 'degraded';
  end if;

  select run.status, run.issue_codes
    into previous_status, previous_issue_codes
  from private.payment_financial_health_runs run
  order by run.completed_at desc
  limit 1;

  completed_at_value := clock_timestamp();
  duration_ms_value := greatest(
    0,
    round(extract(epoch from (completed_at_value - started_at_value)) * 1000)::integer
  );

  insert into private.payment_financial_health_runs (
    status,
    warning_count,
    critical_count,
    issue_count,
    issue_codes,
    checks,
    started_at,
    completed_at,
    duration_ms
  ) values (
    status_value,
    warning_count_value,
    critical_count_value,
    cardinality(issue_codes_value),
    issue_codes_value,
    checks_value,
    started_at_value,
    completed_at_value,
    duration_ms_value
  ) returning id into run_id_value;

  transition_detected := status_value <> 'healthy'
    and (
      previous_status is null
      or previous_status = 'healthy'
      or previous_status is distinct from status_value
      or previous_issue_codes is distinct from issue_codes_value
    );

  if target_notify and transition_detected then
    perform private.enqueue_payment_alert(
      'financial_health_check',
      case when status_value = 'critical' then 'critical' else 'warning' end,
      'financial_health_check:' || run_id_value::text,
      null,
      null,
      null,
      pg_catalog.jsonb_build_object(
        'health_status', status_value,
        'warning_count', warning_count_value,
        'critical_count', critical_count_value,
        'issue_count', cardinality(issue_codes_value),
        'issue_codes', issue_codes_value,
        'health_run_id', run_id_value,
        'completed_at', completed_at_value
      )
    );
  end if;

  delete from private.payment_financial_health_runs run
  where run.completed_at < now() - interval '90 days';

  return pg_catalog.jsonb_build_object(
    'run_id', run_id_value,
    'status', status_value,
    'warning_count', warning_count_value,
    'critical_count', critical_count_value,
    'issue_count', cardinality(issue_codes_value),
    'issue_codes', issue_codes_value,
    'checks', checks_value,
    'completed_at', completed_at_value,
    'duration_ms', duration_ms_value,
    'transition_alert_enqueued', target_notify and transition_detected
  );
exception
  when others then
    error_message := left(sqlerrm, 500);
    completed_at_value := clock_timestamp();
    duration_ms_value := greatest(
      0,
      round(extract(epoch from (completed_at_value - started_at_value)) * 1000)::integer
    );

    insert into private.payment_financial_health_runs (
      status,
      warning_count,
      critical_count,
      issue_count,
      issue_codes,
      checks,
      started_at,
      completed_at,
      duration_ms
    ) values (
      'critical',
      0,
      1,
      1,
      array['health_check_execution_error']::text[],
      pg_catalog.jsonb_build_object('health_check_execution_error', 1, 'error', error_message),
      started_at_value,
      completed_at_value,
      duration_ms_value
    ) returning id into run_id_value;

    if target_notify then
      perform private.enqueue_payment_alert(
        'financial_health_check',
        'critical',
        'financial_health_check:' || run_id_value::text,
        null,
        null,
        null,
        pg_catalog.jsonb_build_object(
          'health_status', 'critical',
          'warning_count', 0,
          'critical_count', 1,
          'issue_count', 1,
          'issue_codes', array['health_check_execution_error']::text[],
          'health_run_id', run_id_value,
          'completed_at', completed_at_value,
          'error', error_message
        )
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'run_id', run_id_value,
      'status', 'critical',
      'warning_count', 0,
      'critical_count', 1,
      'issue_count', 1,
      'issue_codes', array['health_check_execution_error']::text[],
      'checks', pg_catalog.jsonb_build_object('health_check_execution_error', 1),
      'completed_at', completed_at_value,
      'duration_ms', duration_ms_value,
      'transition_alert_enqueued', target_notify
    );
end;
$function$;
