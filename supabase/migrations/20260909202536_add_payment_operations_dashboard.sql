create or replace function public.get_teacher_payment_operations_dashboard(target_reference_month date)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $$
declare
  normalized_month date;
  result jsonb;
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;

  normalized_month := date_trunc('month', coalesce(target_reference_month, current_date))::date;

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
    'last_reconciliation_at', (select max(attempt.last_reconciled_at) from public.tuition_payment_attempts attempt),
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
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_teacher_payment_operations_dashboard(date) from public, anon;
grant execute on function public.get_teacher_payment_operations_dashboard(date) to authenticated;
