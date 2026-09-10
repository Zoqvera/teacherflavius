create table private.payment_financial_health_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  warning_count integer not null default 0,
  critical_count integer not null default 0,
  issue_count integer not null default 0,
  issue_codes text[] not null default '{}'::text[],
  checks jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now(),
  constraint payment_financial_health_runs_status_check check (status in ('healthy','degraded','critical')),
  constraint payment_financial_health_runs_warning_count_check check (warning_count >= 0),
  constraint payment_financial_health_runs_critical_count_check check (critical_count >= 0),
  constraint payment_financial_health_runs_issue_count_check check (issue_count >= 0),
  constraint payment_financial_health_runs_duration_ms_check check (duration_ms >= 0),
  constraint payment_financial_health_runs_checks_object_check check (jsonb_typeof(checks) = 'object'),
  constraint payment_financial_health_runs_timestamps_check check (completed_at >= started_at)
);

create index payment_financial_health_runs_completed_idx
  on private.payment_financial_health_runs (completed_at desc);
create index payment_financial_health_runs_status_completed_idx
  on private.payment_financial_health_runs (status, completed_at desc);

revoke all on table private.payment_financial_health_runs from public, anon, authenticated, service_role;

alter table public.payment_alert_notifications
  drop constraint payment_alert_notifications_type_check;

alter table public.payment_alert_notifications
  add constraint payment_alert_notifications_type_check
  check (alert_type = any (array[
    'reconciliation_failure'::text,
    'reconciliation_stalled'::text,
    'duplicate_payment'::text,
    'approved_without_application'::text,
    'payment_reversal'::text,
    'payment_reversal_pending'::text,
    'invalid_webhook_burst'::text,
    'gateway_failure'::text,
    'chargeback_opened'::text,
    'chargeback_documentation_deadline'::text,
    'financial_health_check'::text
  ]));

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
          or round(coalesce(tuition.amount_paid, 0), 2) is distinct from round(attempt.amount, 2)
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

revoke all on function private.run_payment_financial_health_check(boolean) from public, anon, authenticated, service_role;

create or replace function private.scan_payment_alert_conditions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  approved_count integer := 0;
  reversal_count integer := 0;
  retried_count integer := 0;
  stalled_count integer := 0;
  timed_out_runs integer := 0;
  deleted_runs integer := 0;
  documentation_deadline_count integer := 0;
  financial_health_stalled_count integer := 0;
  minutes_since_success integer;
  minutes_since_health_check integer;
  last_success_at timestamptz;
  last_health_check_at timestamptz;
  attempt_row record;
  chargeback_row record;
  deadline_tier text;
  deadline_severity text;
  hours_remaining integer;
begin
  update public.payment_reconciliation_runs run
  set status = 'failed', completed_at = now(), error_code = coalesce(run.error_code, 'run_timeout')
  where run.status = 'running' and run.started_at < now() - interval '15 minutes';
  get diagnostics timed_out_runs = row_count;

  select max(run.completed_at) into last_success_at
  from public.payment_reconciliation_runs run where run.status = 'succeeded';
  if last_success_at is null or last_success_at < now() - interval '15 minutes' then
    minutes_since_success := case when last_success_at is null then null else floor(extract(epoch from (now() - last_success_at)) / 60)::integer end;
    perform private.enqueue_payment_alert('reconciliation_stalled','warning','reconciliation_stalled:' || coalesce(to_char(last_success_at at time zone 'UTC','YYYYMMDDHH24MISSMS'),'never'),null,null,null,pg_catalog.jsonb_build_object('last_success_at',last_success_at,'minutes_since_success',minutes_since_success));
    stalled_count := 1;
  end if;

  select max(run.completed_at) into last_health_check_at
  from private.payment_financial_health_runs run;
  if last_health_check_at is null or last_health_check_at < now() - interval '15 minutes' then
    minutes_since_health_check := case when last_health_check_at is null then null else floor(extract(epoch from (now() - last_health_check_at)) / 60)::integer end;
    perform private.enqueue_payment_alert(
      'financial_health_check',
      'critical',
      'financial_health_check_stalled:' || coalesce(to_char(last_health_check_at at time zone 'UTC','YYYYMMDDHH24MISSMS'),'never'),
      null,
      null,
      null,
      pg_catalog.jsonb_build_object(
        'health_status','critical',
        'issue_codes',array['financial_health_check_stalled']::text[],
        'last_health_check_at',last_health_check_at,
        'minutes_since_health_check',minutes_since_health_check
      )
    );
    financial_health_stalled_count := 1;
  end if;

  for attempt_row in select attempt.id, attempt.tuition_id, attempt.provider_payment_id, attempt.status from public.tuition_payment_attempts attempt where attempt.status='approved' and attempt.applied_at is null and attempt.updated_at < now()-interval '2 minutes' loop
    perform private.enqueue_payment_alert('approved_without_application','critical','approved_without_application:'||attempt_row.id::text,attempt_row.tuition_id,attempt_row.id,attempt_row.provider_payment_id,pg_catalog.jsonb_build_object('payment_status',attempt_row.status));
    approved_count := approved_count + 1;
  end loop;

  for attempt_row in select attempt.id, attempt.tuition_id, attempt.provider_payment_id, attempt.status from public.tuition_payment_attempts attempt where attempt.status in ('cancelled','refunded','charged_back') and attempt.applied_at is not null and attempt.reversed_at is null and attempt.updated_at < now()-interval '2 minutes' loop
    perform private.enqueue_payment_alert('payment_reversal_pending','critical','payment_reversal_pending:'||attempt_row.id::text||':'||attempt_row.status,attempt_row.tuition_id,attempt_row.id,attempt_row.provider_payment_id,pg_catalog.jsonb_build_object('provider_status',attempt_row.status));
    reversal_count := reversal_count + 1;
  end loop;

  for chargeback_row in
    select cb.id, cb.provider_chargeback_id, cb.tuition_id, cb.attempt_id, cb.provider_payment_id,
           cb.documentation_status, cb.documentation_deadline, coalesce(doc.preparation_status,'not_started') as preparation_status
    from public.payment_chargebacks cb
    left join public.payment_chargeback_documentation_cases doc on doc.chargeback_id = cb.id
    where cb.operational_status='open'
      and cb.documentation_status='pending'
      and cb.documentation_deadline is not null
      and cb.documentation_deadline <= now() + interval '72 hours'
      and coalesce(doc.preparation_status,'not_started') not in ('submitted','closed')
  loop
    hours_remaining := floor(extract(epoch from (chargeback_row.documentation_deadline - now())) / 3600)::integer;
    if chargeback_row.documentation_deadline < now() then deadline_tier := 'overdue'; deadline_severity := 'critical';
    elsif chargeback_row.documentation_deadline <= now() + interval '24 hours' then deadline_tier := '24h'; deadline_severity := 'critical';
    else deadline_tier := '72h'; deadline_severity := 'warning'; end if;

    perform private.enqueue_payment_alert(
      'chargeback_documentation_deadline', deadline_severity,
      'chargeback_documentation_deadline:'||chargeback_row.provider_chargeback_id||':'||deadline_tier,
      chargeback_row.tuition_id, chargeback_row.attempt_id, chargeback_row.provider_payment_id,
      pg_catalog.jsonb_build_object('chargeback_id',chargeback_row.provider_chargeback_id,'documentation_status',chargeback_row.documentation_status,'documentation_deadline',chargeback_row.documentation_deadline,'hours_remaining',hours_remaining,'preparation_status',chargeback_row.preparation_status,'deadline_tier',deadline_tier)
    );
    documentation_deadline_count := documentation_deadline_count + 1;
  end loop;

  update public.payment_alert_notifications alert set status='pending', updated_at=now()
  where alert.status='failed' and alert.attempts<5 and coalesce(alert.last_attempt_at,alert.created_at)<now()-interval '10 minutes';
  get diagnostics retried_count = row_count;

  delete from public.payment_reconciliation_runs run where run.status in ('succeeded','failed') and run.completed_at < now()-interval '90 days';
  get diagnostics deleted_runs = row_count;

  return pg_catalog.jsonb_build_object('approved_without_application',approved_count,'payment_reversal_pending',reversal_count,'reconciliation_stalled',stalled_count,'financial_health_check_stalled',financial_health_stalled_count,'chargeback_documentation_deadline',documentation_deadline_count,'timed_out_reconciliation_runs',timed_out_runs,'retried_alerts',retried_count,'deleted_reconciliation_runs',deleted_runs,'last_reconciliation_success_at',last_success_at,'last_financial_health_check_at',last_health_check_at);
end;
$function$;

create or replace function public.get_teacher_payment_operations_dashboard(target_reference_month date)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $function$
declare
  normalized_month date;
  last_success_at timestamptz;
  health_status text;
  health_completed_at timestamptz;
  health_warning_count integer;
  health_critical_count integer;
  health_issue_count integer;
  health_issue_codes text[];
  result jsonb;
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;

  normalized_month := date_trunc('month', coalesce(target_reference_month, current_date))::date;

  select max(run.completed_at)
    into last_success_at
  from public.payment_reconciliation_runs run
  where run.status = 'succeeded';

  if last_success_at is null then
    select max(attempt.last_reconciled_at)
      into last_success_at
    from public.tuition_payment_attempts attempt;
  end if;

  select run.status, run.completed_at, run.warning_count, run.critical_count, run.issue_count, run.issue_codes
    into health_status, health_completed_at, health_warning_count, health_critical_count, health_issue_count, health_issue_codes
  from private.payment_financial_health_runs run
  order by run.completed_at desc
  limit 1;

  select jsonb_build_object(
    'reference_month', normalized_month,
    'generated_at', now(),
    'approved', (
      select jsonb_build_object('count', count(*)::int, 'amount', coalesce(sum(attempt.amount), 0))
      from public.tuition_payment_attempts attempt
      join public.monthly_tuition tuition on tuition.id = attempt.tuition_id
      where tuition.reference_month = normalized_month and attempt.status = 'approved'
    ),
    'pending', (
      select jsonb_build_object('count', count(*)::int, 'amount', coalesce(sum(attempt.amount), 0))
      from public.tuition_payment_attempts attempt
      join public.monthly_tuition tuition on tuition.id = attempt.tuition_id
      where tuition.reference_month = normalized_month
        and attempt.status in ('created','pending','authorized','in_process','in_mediation')
    ),
    'rejected', (
      select jsonb_build_object('count', count(*)::int, 'amount', coalesce(sum(attempt.amount), 0))
      from public.tuition_payment_attempts attempt
      join public.monthly_tuition tuition on tuition.id = attempt.tuition_id
      where tuition.reference_month = normalized_month and attempt.status = 'rejected'
    ),
    'methods', coalesce((
      select jsonb_object_agg(method, jsonb_build_object('count', method_count, 'amount', method_amount))
      from (
        select coalesce(attempt.payment_method, 'unknown') as method,
               count(*)::int as method_count,
               coalesce(sum(attempt.amount), 0) as method_amount
        from public.tuition_payment_attempts attempt
        join public.monthly_tuition tuition on tuition.id = attempt.tuition_id
        where tuition.reference_month = normalized_month and attempt.status = 'approved'
        group by coalesce(attempt.payment_method, 'unknown')
      ) method_stats
    ), '{}'::jsonb),
    'gateway_failures_24h', (
      select count(*)::int from public.payment_operational_events event
      where event.event_type = 'gateway_failure' and event.created_at >= now() - interval '24 hours'
    ),
    'invalid_webhooks_24h', (
      select count(*)::int from public.payment_operational_events event
      where event.event_type = 'invalid_webhook_signature' and event.created_at >= now() - interval '24 hours'
    ),
    'last_reconciliation_at', last_success_at,
    'reconciliation_stalled', coalesce(last_success_at < now() - interval '15 minutes', true),
    'reconciliation_failures', (
      select count(*)::int from public.tuition_payment_attempts attempt where attempt.reconciliation_failure_count > 0
    ),
    'divergences', jsonb_build_object(
      'approved_without_application', (
        select count(*)::int from public.tuition_payment_attempts attempt
        where attempt.status = 'approved' and attempt.applied_at is null
      ),
      'reversal_pending', (
        select count(*)::int from public.tuition_payment_attempts attempt
        where attempt.status in ('cancelled','refunded','charged_back')
          and attempt.applied_at is not null and attempt.reversed_at is null
      )
    ),
    'duplicate_payments', (
      select count(*)::int
      from public.monthly_tuition_events event
      join public.monthly_tuition tuition on tuition.id = event.tuition_id
      where tuition.reference_month = normalized_month and event.action = 'duplicate_payment_detected'
    ),
    'reversals', (
      select count(*)::int
      from public.monthly_tuition_events event
      join public.monthly_tuition tuition on tuition.id = event.tuition_id
      where tuition.reference_month = normalized_month and event.action = 'payment_reversed'
    ),
    'alerts', jsonb_build_object(
      'pending', (select count(*)::int from public.payment_alert_notifications where status = 'pending'),
      'failed', (select count(*)::int from public.payment_alert_notifications where status = 'failed'),
      'critical_open', (
        select count(*)::int from public.payment_alert_notifications
        where severity = 'critical' and status in ('pending','failed')
      )
    ),
    'financial_health', jsonb_build_object(
      'status', coalesce(health_status, 'unknown'),
      'completed_at', health_completed_at,
      'stale', coalesce(health_completed_at < now() - interval '15 minutes', true),
      'warning_count', coalesce(health_warning_count, 0),
      'critical_count', coalesce(health_critical_count, 0),
      'issue_count', coalesce(health_issue_count, 0),
      'issue_codes', coalesce(to_jsonb(health_issue_codes), '[]'::jsonb)
    )
  ) into result;

  return result;
end;
$function$;

select cron.schedule(
  'payment-financial-health-check',
  '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
  'select private.run_payment_financial_health_check(true);'
);

select private.run_payment_financial_health_check(false);
