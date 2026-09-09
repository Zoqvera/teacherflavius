create table public.payment_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error_code text,
  constraint payment_reconciliation_runs_status_check
    check (status in ('running','succeeded','failed')),
  constraint payment_reconciliation_runs_summary_check
    check (jsonb_typeof(summary) = 'object'),
  constraint payment_reconciliation_runs_error_code_check
    check (error_code is null or length(error_code) between 1 and 160),
  constraint payment_reconciliation_runs_completion_check
    check (
      (status = 'running' and completed_at is null)
      or (status in ('succeeded','failed') and completed_at is not null and completed_at >= started_at)
    )
);

create index payment_reconciliation_runs_status_completed_idx
  on public.payment_reconciliation_runs (status, completed_at desc);

alter table public.payment_reconciliation_runs enable row level security;
revoke all on table public.payment_reconciliation_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_reconciliation_runs to service_role;

create or replace function public.begin_mercado_pago_reconciliation_run()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id uuid;
begin
  insert into public.payment_reconciliation_runs (status)
  values ('running')
  returning id into run_id;

  return run_id;
end;
$$;

revoke all on function public.begin_mercado_pago_reconciliation_run() from public, anon, authenticated;
grant execute on function public.begin_mercado_pago_reconciliation_run() to service_role;

create or replace function public.finish_mercado_pago_reconciliation_run(
  target_run_id uuid,
  target_status text,
  target_summary jsonb default '{}'::jsonb,
  target_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
  normalized_status text := lower(trim(coalesce(target_status, '')));
begin
  if normalized_status not in ('succeeded','failed') then
    raise exception 'Invalid reconciliation run status.';
  end if;

  update public.payment_reconciliation_runs
  set
    status = normalized_status,
    completed_at = now(),
    summary = case
      when jsonb_typeof(coalesce(target_summary, '{}'::jsonb)) = 'object'
        then coalesce(target_summary, '{}'::jsonb)
      else '{}'::jsonb
    end,
    error_code = nullif(left(trim(coalesce(target_error_code, '')), 160), '')
  where id = target_run_id
    and status = 'running';

  get diagnostics affected_count = row_count;
  return affected_count = 1;
end;
$$;

revoke all on function public.finish_mercado_pago_reconciliation_run(uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.finish_mercado_pago_reconciliation_run(uuid,text,jsonb,text) to service_role;

alter table public.payment_alert_notifications
  drop constraint if exists payment_alert_notifications_type_check;

alter table public.payment_alert_notifications
  add constraint payment_alert_notifications_type_check check (alert_type in (
    'reconciliation_failure',
    'reconciliation_stalled',
    'duplicate_payment',
    'approved_without_application',
    'payment_reversal',
    'payment_reversal_pending',
    'invalid_webhook_burst',
    'gateway_failure'
  ));

insert into public.payment_reconciliation_runs (
  status,
  started_at,
  completed_at,
  summary
) values (
  'succeeded',
  now(),
  now(),
  jsonb_build_object('source', 'migration_baseline')
);

create or replace function private.scan_payment_alert_conditions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_count integer := 0;
  reversal_count integer := 0;
  retried_count integer := 0;
  stalled_count integer := 0;
  timed_out_runs integer := 0;
  deleted_runs integer := 0;
  minutes_since_success integer;
  last_success_at timestamptz;
  attempt_row record;
begin
  update public.payment_reconciliation_runs run
  set
    status = 'failed',
    completed_at = now(),
    error_code = coalesce(run.error_code, 'run_timeout')
  where run.status = 'running'
    and run.started_at < now() - interval '15 minutes';
  get diagnostics timed_out_runs = row_count;

  select max(run.completed_at)
    into last_success_at
  from public.payment_reconciliation_runs run
  where run.status = 'succeeded';

  if last_success_at is null or last_success_at < now() - interval '15 minutes' then
    minutes_since_success := case
      when last_success_at is null then null
      else floor(extract(epoch from (now() - last_success_at)) / 60)::integer
    end;

    perform private.enqueue_payment_alert(
      'reconciliation_stalled',
      'warning',
      'reconciliation_stalled:' || coalesce(
        to_char(last_success_at at time zone 'UTC', 'YYYYMMDDHH24MISSMS'),
        'never'
      ),
      null,
      null,
      null,
      pg_catalog.jsonb_build_object(
        'last_success_at', last_success_at,
        'minutes_since_success', minutes_since_success
      )
    );
    stalled_count := 1;
  end if;

  for attempt_row in
    select attempt.id, attempt.tuition_id, attempt.provider_payment_id, attempt.status
    from public.tuition_payment_attempts attempt
    where attempt.status = 'approved'
      and attempt.applied_at is null
      and attempt.updated_at < now() - interval '2 minutes'
  loop
    perform private.enqueue_payment_alert(
      'approved_without_application',
      'critical',
      'approved_without_application:' || attempt_row.id::text,
      attempt_row.tuition_id,
      attempt_row.id,
      attempt_row.provider_payment_id,
      pg_catalog.jsonb_build_object('payment_status', attempt_row.status)
    );
    approved_count := approved_count + 1;
  end loop;

  for attempt_row in
    select attempt.id, attempt.tuition_id, attempt.provider_payment_id, attempt.status
    from public.tuition_payment_attempts attempt
    where attempt.status in ('cancelled','refunded','charged_back')
      and attempt.applied_at is not null
      and attempt.reversed_at is null
      and attempt.updated_at < now() - interval '2 minutes'
  loop
    perform private.enqueue_payment_alert(
      'payment_reversal_pending',
      'critical',
      'payment_reversal_pending:' || attempt_row.id::text || ':' || attempt_row.status,
      attempt_row.tuition_id,
      attempt_row.id,
      attempt_row.provider_payment_id,
      pg_catalog.jsonb_build_object('provider_status', attempt_row.status)
    );
    reversal_count := reversal_count + 1;
  end loop;

  update public.payment_alert_notifications alert
  set status = 'pending', updated_at = now()
  where alert.status = 'failed'
    and alert.attempts < 5
    and coalesce(alert.last_attempt_at, alert.created_at) < now() - interval '10 minutes';
  get diagnostics retried_count = row_count;

  delete from public.payment_reconciliation_runs run
  where run.status in ('succeeded','failed')
    and run.completed_at < now() - interval '90 days';
  get diagnostics deleted_runs = row_count;

  return pg_catalog.jsonb_build_object(
    'approved_without_application', approved_count,
    'payment_reversal_pending', reversal_count,
    'reconciliation_stalled', stalled_count,
    'timed_out_reconciliation_runs', timed_out_runs,
    'retried_alerts', retried_count,
    'deleted_reconciliation_runs', deleted_runs,
    'last_reconciliation_success_at', last_success_at
  );
end;
$$;

revoke all on function private.scan_payment_alert_conditions() from public, anon, authenticated;

create or replace function public.get_teacher_payment_operations_dashboard(target_reference_month date)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $$
declare
  normalized_month date;
  last_success_at timestamptz;
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
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_teacher_payment_operations_dashboard(date) from public, anon;
grant execute on function public.get_teacher_payment_operations_dashboard(date) to authenticated;
