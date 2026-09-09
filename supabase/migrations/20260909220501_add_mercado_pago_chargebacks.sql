create table if not exists public.payment_chargebacks (
  id uuid primary key default gen_random_uuid(),
  provider_chargeback_id text not null unique,
  provider_payment_id text not null,
  attempt_id uuid not null references public.tuition_payment_attempts(id) on delete restrict,
  tuition_id uuid not null references public.monthly_tuition(id) on delete restrict,
  source_webhook_event_id uuid references public.payment_webhook_events(id) on delete set null,
  amount numeric(12,2),
  currency text,
  reason text,
  reason_id text,
  coverage_applied boolean,
  coverage_eligible boolean,
  documentation_required boolean,
  documentation_status text,
  documentation_deadline timestamptz,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  live_mode boolean,
  payment_status text,
  operational_status text not null default 'open' check (operational_status in ('open','won','lost')),
  last_reconciled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_chargebacks_payment_idx on public.payment_chargebacks(provider_payment_id);
create index if not exists payment_chargebacks_attempt_idx on public.payment_chargebacks(attempt_id);
create index if not exists payment_chargebacks_tuition_idx on public.payment_chargebacks(tuition_id);
create index if not exists payment_chargebacks_status_reconcile_idx
  on public.payment_chargebacks(operational_status, last_reconciled_at)
  where operational_status = 'open';

alter table public.payment_chargebacks enable row level security;
revoke all on table public.payment_chargebacks from public, anon, authenticated;
grant select, insert, update on table public.payment_chargebacks to service_role;

alter table public.payment_alert_notifications
  drop constraint if exists payment_alert_notifications_type_check;
alter table public.payment_alert_notifications
  add constraint payment_alert_notifications_type_check check (alert_type = any (array[
    'reconciliation_failure'::text,
    'reconciliation_stalled'::text,
    'duplicate_payment'::text,
    'approved_without_application'::text,
    'payment_reversal'::text,
    'payment_reversal_pending'::text,
    'invalid_webhook_burst'::text,
    'gateway_failure'::text,
    'chargeback_opened'::text
  ]));

alter table public.monthly_tuition_events
  drop constraint if exists monthly_tuition_events_action_check;
alter table public.monthly_tuition_events
  add constraint monthly_tuition_events_action_check check (action = any (array[
    'payment_recorded'::text,
    'payment_reversed'::text,
    'payment_reinstated'::text,
    'tuition_exempted'::text,
    'tuition_exemption_reversed'::text,
    'duplicate_payment_detected'::text
  ]));

create or replace function public.upsert_mercado_pago_chargeback(
  target_provider_chargeback_id text,
  target_provider_payment_id text,
  target_source_webhook_event_id uuid,
  target_amount numeric,
  target_currency text,
  target_reason text,
  target_reason_id text,
  target_coverage_applied boolean,
  target_coverage_eligible boolean,
  target_documentation_required boolean,
  target_documentation_status text,
  target_documentation_deadline timestamptz,
  target_provider_created_at timestamptz,
  target_provider_updated_at timestamptz,
  target_live_mode boolean,
  target_payment_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attempt_row public.tuition_payment_attempts%rowtype;
  chargeback_row public.payment_chargebacks%rowtype;
  normalized_chargeback_id text := trim(coalesce(target_provider_chargeback_id, ''));
  normalized_payment_id text := trim(coalesce(target_provider_payment_id, ''));
  normalized_documentation_status text := lower(trim(coalesce(target_documentation_status, '')));
  normalized_payment_status text := lower(trim(coalesce(target_payment_status, '')));
  normalized_operational_status text := 'open';
  was_new boolean := false;
begin
  if normalized_chargeback_id = '' or length(normalized_chargeback_id) > 128 then
    raise exception 'Identificador da contestação inválido.' using errcode = '22023';
  end if;
  if normalized_payment_id = '' or length(normalized_payment_id) > 128 then
    raise exception 'Identificador do pagamento da contestação inválido.' using errcode = '22023';
  end if;

  select attempt.* into attempt_row
  from public.tuition_payment_attempts attempt
  where attempt.provider = 'mercado_pago'
    and attempt.provider_payment_id = normalized_payment_id
  order by attempt.created_at desc
  limit 1;

  if not found then
    raise exception 'Tentativa de pagamento da contestação não encontrada.' using errcode = 'P0002';
  end if;

  if target_coverage_applied is true then
    normalized_operational_status := 'won';
  elsif target_coverage_applied is false
    and normalized_payment_status = 'charged_back'
    and normalized_documentation_status in ('valid','not_supplied','not supplied') then
    normalized_operational_status := 'lost';
  end if;

  insert into public.payment_chargebacks (
    provider_chargeback_id, provider_payment_id, attempt_id, tuition_id, source_webhook_event_id,
    amount, currency, reason, reason_id, coverage_applied, coverage_eligible,
    documentation_required, documentation_status, documentation_deadline,
    provider_created_at, provider_updated_at, live_mode, payment_status,
    operational_status, last_reconciled_at, last_error
  ) values (
    normalized_chargeback_id, normalized_payment_id, attempt_row.id, attempt_row.tuition_id,
    target_source_webhook_event_id,
    case when target_amount is null then null else round(target_amount, 2) end,
    nullif(upper(left(trim(coalesce(target_currency, '')), 12)), ''),
    nullif(left(trim(coalesce(target_reason, '')), 240), ''),
    nullif(left(trim(coalesce(target_reason_id, '')), 80), ''),
    target_coverage_applied, target_coverage_eligible, target_documentation_required,
    nullif(left(normalized_documentation_status, 80), ''), target_documentation_deadline,
    target_provider_created_at, target_provider_updated_at, target_live_mode,
    nullif(left(normalized_payment_status, 40), ''), normalized_operational_status,
    now(), null
  )
  on conflict (provider_chargeback_id) do update set
    provider_payment_id = excluded.provider_payment_id,
    attempt_id = excluded.attempt_id,
    tuition_id = excluded.tuition_id,
    source_webhook_event_id = coalesce(excluded.source_webhook_event_id, public.payment_chargebacks.source_webhook_event_id),
    amount = excluded.amount,
    currency = excluded.currency,
    reason = excluded.reason,
    reason_id = excluded.reason_id,
    coverage_applied = excluded.coverage_applied,
    coverage_eligible = excluded.coverage_eligible,
    documentation_required = excluded.documentation_required,
    documentation_status = excluded.documentation_status,
    documentation_deadline = excluded.documentation_deadline,
    provider_created_at = coalesce(public.payment_chargebacks.provider_created_at, excluded.provider_created_at),
    provider_updated_at = excluded.provider_updated_at,
    live_mode = excluded.live_mode,
    payment_status = excluded.payment_status,
    operational_status = excluded.operational_status,
    last_reconciled_at = now(),
    last_error = null,
    updated_at = now()
  returning * into chargeback_row;

  select chargeback_row.created_at = chargeback_row.updated_at into was_new;

  return jsonb_build_object(
    'ok', true,
    'id', chargeback_row.id,
    'tuition_id', chargeback_row.tuition_id,
    'attempt_id', chargeback_row.attempt_id,
    'operational_status', chargeback_row.operational_status,
    'is_new', was_new
  );
end;
$$;

create or replace function public.mark_mercado_pago_payment_reinstated(
  target_attempt_id uuid,
  target_provider_payment_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attempt_row public.tuition_payment_attempts%rowtype;
  changed integer := 0;
begin
  select * into attempt_row
  from public.tuition_payment_attempts attempt
  where attempt.id = target_attempt_id
    and attempt.provider = 'mercado_pago'
    and attempt.provider_payment_id = trim(coalesce(target_provider_payment_id, ''))
    and attempt.status = 'approved'
  for update;

  if not found or attempt_row.reversed_at is null then return false; end if;

  if not exists (
    select 1 from public.monthly_tuition tuition
    where tuition.id = attempt_row.tuition_id
      and tuition.payment_date is not null
      and tuition.payment_provider = 'mercado_pago'
      and tuition.provider_payment_id = attempt_row.provider_payment_id
  ) then
    return false;
  end if;

  update public.tuition_payment_attempts
  set reversed_at = null, updated_at = now()
  where id = attempt_row.id and reversed_at is not null;
  get diagnostics changed = row_count;

  if changed > 0 then
    insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
    values (
      attempt_row.tuition_id,
      'payment_reinstated',
      null,
      jsonb_build_object(
        'source', 'mercado_pago',
        'attempt_id', attempt_row.id,
        'provider_payment_id', attempt_row.provider_payment_id,
        'reason', 'provider_reapproved_after_reversal'
      )
    );
  end if;

  return changed > 0;
end;
$$;

create or replace function private.capture_mercado_pago_chargeback_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_payment_alert(
    'chargeback_opened',
    'critical',
    'chargeback-opened:' || new.provider_chargeback_id,
    new.tuition_id,
    new.attempt_id,
    new.provider_payment_id,
    jsonb_build_object(
      'chargeback_id', new.provider_chargeback_id,
      'amount', new.amount,
      'currency', new.currency,
      'reason', new.reason,
      'documentation_status', new.documentation_status,
      'documentation_deadline', new.documentation_deadline,
      'coverage_eligible', new.coverage_eligible
    )
  );
  return new;
end;
$$;

drop trigger if exists payment_chargebacks_alert_trigger on public.payment_chargebacks;
create trigger payment_chargebacks_alert_trigger
after insert on public.payment_chargebacks
for each row execute function private.capture_mercado_pago_chargeback_alert();

revoke all on function public.upsert_mercado_pago_chargeback(text,text,uuid,numeric,text,text,text,boolean,boolean,boolean,text,timestamptz,timestamptz,timestamptz,boolean,text) from public, anon, authenticated;
grant execute on function public.upsert_mercado_pago_chargeback(text,text,uuid,numeric,text,text,text,boolean,boolean,boolean,text,timestamptz,timestamptz,timestamptz,boolean,text) to service_role;
revoke all on function public.mark_mercado_pago_payment_reinstated(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_mercado_pago_payment_reinstated(uuid,text) to service_role;
revoke all on function private.capture_mercado_pago_chargeback_alert() from public, anon, authenticated;
