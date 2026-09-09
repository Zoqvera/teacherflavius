create table public.payment_alert_notifications (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity text not null,
  dedupe_key text not null unique,
  tuition_id uuid references public.monthly_tuition(id) on delete set null,
  attempt_id uuid references public.tuition_payment_attempts(id) on delete set null,
  provider_payment_id text,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_alert_notifications_type_check check (alert_type in (
    'reconciliation_failure',
    'duplicate_payment',
    'approved_without_application',
    'payment_reversal',
    'payment_reversal_pending',
    'invalid_webhook_burst',
    'gateway_failure'
  )),
  constraint payment_alert_notifications_severity_check check (severity in ('warning','critical')),
  constraint payment_alert_notifications_status_check check (status in ('pending','sent','failed')),
  constraint payment_alert_notifications_attempts_check check (attempts >= 0),
  constraint payment_alert_notifications_provider_id_check check (
    provider_payment_id is null or length(provider_payment_id) between 1 and 128
  )
);

create index payment_alert_notifications_status_created_idx
  on public.payment_alert_notifications (status, created_at desc);
create index payment_alert_notifications_type_created_idx
  on public.payment_alert_notifications (alert_type, created_at desc);

alter table public.payment_alert_notifications enable row level security;
revoke all on table public.payment_alert_notifications from public, anon, authenticated;

create table public.payment_operational_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_code text,
  attempt_id uuid references public.tuition_payment_attempts(id) on delete set null,
  provider_payment_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_operational_events_type_check check (event_type in (
    'invalid_webhook_signature',
    'gateway_failure'
  )),
  constraint payment_operational_events_code_check check (
    event_code is null or length(event_code) between 1 and 160
  ),
  constraint payment_operational_events_provider_id_check check (
    provider_payment_id is null or length(provider_payment_id) between 1 and 128
  )
);

create index payment_operational_events_type_created_idx
  on public.payment_operational_events (event_type, created_at desc);

alter table public.payment_operational_events enable row level security;
revoke all on table public.payment_operational_events from public, anon, authenticated;

create or replace function private.enqueue_payment_alert(
  target_alert_type text,
  target_severity text,
  target_dedupe_key text,
  target_tuition_id uuid default null,
  target_attempt_id uuid default null,
  target_provider_payment_id text default null,
  target_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_id uuid;
begin
  insert into public.payment_alert_notifications (
    alert_type,
    severity,
    dedupe_key,
    tuition_id,
    attempt_id,
    provider_payment_id,
    details
  ) values (
    target_alert_type,
    target_severity,
    left(target_dedupe_key, 240),
    target_tuition_id,
    target_attempt_id,
    nullif(left(coalesce(target_provider_payment_id, ''), 128), ''),
    coalesce(target_details, '{}'::jsonb)
  )
  on conflict (dedupe_key) do nothing
  returning id into alert_id;

  if alert_id is null then
    select alert.id
      into alert_id
    from public.payment_alert_notifications alert
    where alert.dedupe_key = left(target_dedupe_key, 240);
  end if;

  return alert_id;
end;
$$;

revoke all on function private.enqueue_payment_alert(text,text,text,uuid,uuid,text,jsonb) from public, anon, authenticated;

create or replace function private.dispatch_payment_alert_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
begin
  select ds.decrypted_secret
    into webhook_secret
  from vault.decrypted_secrets ds
  where ds.name = 'teacherflavius_notification_webhook_secret'
  limit 1;

  if nullif(webhook_secret, '') is null then
    raise warning 'Payment alert webhook secret is unavailable';
    return new;
  end if;

  perform net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-payment-alert',
    body := pg_catalog.jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', pg_catalog.jsonb_build_object('id', new.id)
    ),
    params := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke all on function private.dispatch_payment_alert_webhook() from public, anon, authenticated;

create trigger dispatch_payment_alert_on_insert
after insert on public.payment_alert_notifications
for each row
when (new.status = 'pending')
execute function private.dispatch_payment_alert_webhook();

create trigger dispatch_payment_alert_on_retry
after update of status on public.payment_alert_notifications
for each row
when (old.status is distinct from new.status and new.status = 'pending')
execute function private.dispatch_payment_alert_webhook();

create or replace function private.capture_payment_event_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_status text;
  alert_severity text;
begin
  if new.action = 'duplicate_payment_detected' then
    perform private.enqueue_payment_alert(
      'duplicate_payment',
      'critical',
      'duplicate_payment:' || new.id::text,
      new.tuition_id,
      nullif(new.details ->> 'attempt_id', '')::uuid,
      new.details ->> 'provider_payment_id',
      pg_catalog.jsonb_build_object(
        'amount', new.details -> 'amount',
        'payment_method', new.details -> 'payment_method'
      )
    );
  elsif new.action = 'payment_reversed' then
    provider_status := lower(coalesce(new.details ->> 'provider_status', ''));
    if provider_status in ('refunded','charged_back','cancelled') then
      alert_severity := case when provider_status = 'charged_back' then 'critical' else 'warning' end;
      perform private.enqueue_payment_alert(
        'payment_reversal',
        alert_severity,
        'payment_reversal:' || new.id::text,
        new.tuition_id,
        nullif(new.details ->> 'attempt_id', '')::uuid,
        new.details ->> 'provider_payment_id',
        pg_catalog.jsonb_build_object(
          'provider_status', provider_status,
          'status_detail', new.details -> 'status_detail'
        )
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.capture_payment_event_alert() from public, anon, authenticated;

create trigger capture_payment_event_alert
after insert on public.monthly_tuition_events
for each row
when (new.action in ('duplicate_payment_detected','payment_reversed'))
execute function private.capture_payment_event_alert();

create or replace function private.capture_payment_attempt_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.reconciliation_failure_count, 0) > 0
     and coalesce(old.reconciliation_failure_count, 0) = 0 then
    perform private.enqueue_payment_alert(
      'reconciliation_failure',
      'warning',
      'reconciliation_failure:' || new.id::text,
      new.tuition_id,
      new.id,
      new.provider_payment_id,
      pg_catalog.jsonb_build_object(
        'failure_count', new.reconciliation_failure_count,
        'error', left(coalesce(new.last_reconciliation_error, ''), 300),
        'payment_status', new.status
      )
    );
  end if;

  if new.status_detail is distinct from old.status_detail
     and coalesce(new.status_detail, '') ~ '^provider_http_(429|5[0-9]{2})_' then
    insert into public.payment_operational_events (
      event_type,
      event_code,
      attempt_id,
      provider_payment_id,
      details
    ) values (
      'gateway_failure',
      left(new.status_detail, 160),
      new.id,
      new.provider_payment_id,
      pg_catalog.jsonb_build_object('payment_status', new.status)
    );
  end if;

  return new;
end;
$$;

revoke all on function private.capture_payment_attempt_alert() from public, anon, authenticated;

create trigger capture_payment_attempt_alert
after update of reconciliation_failure_count, status_detail on public.tuition_payment_attempts
for each row
execute function private.capture_payment_attempt_alert();

create or replace function private.process_payment_operational_event_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
  time_bucket text;
begin
  time_bucket := floor(extract(epoch from new.created_at) / 900)::bigint::text;

  if new.event_type = 'invalid_webhook_signature' then
    select count(*)::integer
      into recent_count
    from public.payment_operational_events event
    where event.event_type = 'invalid_webhook_signature'
      and event.created_at >= new.created_at - interval '15 minutes';

    if recent_count >= 3 then
      perform private.enqueue_payment_alert(
        'invalid_webhook_burst',
        'warning',
        'invalid_webhook_burst:' || time_bucket,
        null,
        null,
        null,
        pg_catalog.jsonb_build_object('count_15m', recent_count)
      );
    end if;
  elsif new.event_type = 'gateway_failure' then
    perform private.enqueue_payment_alert(
      'gateway_failure',
      'warning',
      'gateway_failure:' || time_bucket,
      null,
      new.attempt_id,
      new.provider_payment_id,
      pg_catalog.jsonb_build_object('code', new.event_code)
    );
  end if;

  return new;
end;
$$;

revoke all on function private.process_payment_operational_event_alert() from public, anon, authenticated;

create trigger process_payment_operational_event_alert
after insert on public.payment_operational_events
for each row
execute function private.process_payment_operational_event_alert();

create or replace function public.record_payment_operational_event(
  target_event_type text,
  target_event_code text default null,
  target_attempt_id uuid default null,
  target_provider_payment_id text default null,
  target_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
begin
  if target_event_type not in ('invalid_webhook_signature','gateway_failure') then
    raise exception 'Invalid payment operational event type.';
  end if;

  insert into public.payment_operational_events (
    event_type,
    event_code,
    attempt_id,
    provider_payment_id,
    details
  ) values (
    target_event_type,
    nullif(left(trim(coalesce(target_event_code, '')), 160), ''),
    target_attempt_id,
    nullif(left(trim(coalesce(target_provider_payment_id, '')), 128), ''),
    coalesce(target_details, '{}'::jsonb)
  )
  returning id into event_id;

  return event_id;
end;
$$;

revoke all on function public.record_payment_operational_event(text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_payment_operational_event(text,text,uuid,text,jsonb) to service_role;

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
  attempt_row record;
begin
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

  return pg_catalog.jsonb_build_object(
    'approved_without_application', approved_count,
    'payment_reversal_pending', reversal_count,
    'retried_alerts', retried_count
  );
end;
$$;

revoke all on function private.scan_payment_alert_conditions() from public, anon, authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'payment-alert-health-scan'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'payment-alert-health-scan',
    '*/5 * * * *',
    'select private.scan_payment_alert_conditions();'
  );
end;
$$;
