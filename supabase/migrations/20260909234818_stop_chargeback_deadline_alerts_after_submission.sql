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
  minutes_since_success integer;
  last_success_at timestamptz;
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

  return pg_catalog.jsonb_build_object('approved_without_application',approved_count,'payment_reversal_pending',reversal_count,'reconciliation_stalled',stalled_count,'chargeback_documentation_deadline',documentation_deadline_count,'timed_out_reconciliation_runs',timed_out_runs,'retried_alerts',retried_count,'deleted_reconciliation_runs',deleted_runs,'last_reconciliation_success_at',last_success_at);
end;
$function$;
