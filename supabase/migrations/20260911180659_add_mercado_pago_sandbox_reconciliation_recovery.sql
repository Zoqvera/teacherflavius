create table public.mercado_pago_sandbox_reconciliation_candidates (
  id uuid primary key default gen_random_uuid(),
  scenario text not null default 'missed_webhook',
  external_reference text not null unique,
  expected_amount numeric(12,2) not null,
  provider_payment_id text,
  provider_status text,
  provider_status_detail text,
  payment_method_id text,
  live_mode boolean,
  reconciliation_status text not null default 'pending',
  reconciliation_attempts integer not null default 0,
  last_error_code text,
  first_reconciled_at timestamptz,
  last_reconciled_at timestamptz,
  recovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercado_pago_sandbox_reconciliation_scenario_check
    check (scenario = 'missed_webhook'),
  constraint mercado_pago_sandbox_reconciliation_reference_check
    check (external_reference like 'sandbox-card-%'),
  constraint mercado_pago_sandbox_reconciliation_amount_check
    check (expected_amount > 0),
  constraint mercado_pago_sandbox_reconciliation_status_check
    check (reconciliation_status in ('pending', 'recovered', 'failed')),
  constraint mercado_pago_sandbox_reconciliation_attempts_check
    check (reconciliation_attempts >= 0),
  constraint mercado_pago_sandbox_reconciliation_live_mode_check
    check (live_mode is null or live_mode = false),
  constraint mercado_pago_sandbox_reconciliation_recovered_check
    check (
      reconciliation_status <> 'recovered'
      or (
        provider_payment_id is not null
        and provider_status is not null
        and recovered_at is not null
        and live_mode = false
      )
    )
);

create index mercado_pago_sandbox_reconciliation_status_idx
  on public.mercado_pago_sandbox_reconciliation_candidates (reconciliation_status, created_at);

alter table public.mercado_pago_sandbox_reconciliation_candidates enable row level security;

revoke all on table public.mercado_pago_sandbox_reconciliation_candidates
  from public, anon, authenticated;
grant select, insert, update, delete on table public.mercado_pago_sandbox_reconciliation_candidates
  to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.dispatch_mercado_pago_sandbox_reconciliation()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  reconciliation_secret text;
  request_timestamp text;
  request_signature text;
  request_id bigint;
begin
  select ds.decrypted_secret
    into reconciliation_secret
  from vault.decrypted_secrets as ds
  where ds.name = 'mercado_pago_reconciliation_cron_secret'
  limit 1;

  if nullif(reconciliation_secret, '') is null then
    raise warning 'Mercado Pago reconciliation secret is unavailable';
    return null;
  end if;

  request_timestamp := floor(extract(epoch from pg_catalog.clock_timestamp()))::bigint::text;
  request_signature := pg_catalog.encode(
    extensions.hmac(request_timestamp, reconciliation_secret, 'sha256'),
    'hex'
  );

  select net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/reconcile-mercado-pago-sandbox',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reconciliation-timestamp', request_timestamp,
      'x-reconciliation-signature', request_signature
    ),
    timeout_milliseconds := 30000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.dispatch_mercado_pago_sandbox_reconciliation()
  from public, anon, authenticated;
grant execute on function private.dispatch_mercado_pago_sandbox_reconciliation()
  to service_role;
