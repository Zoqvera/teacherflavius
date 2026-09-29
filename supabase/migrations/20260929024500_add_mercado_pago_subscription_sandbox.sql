create table if not exists public.mercado_pago_subscription_sandbox_events (
  id uuid primary key default gen_random_uuid(),
  deduplication_key text not null unique,
  request_id text,
  provider_event_id text,
  provider_resource_id text not null,
  event_type text not null,
  action text,
  live_mode boolean not null default false,
  signature_valid boolean not null default true,
  provider_status text,
  provider_status_detail text,
  external_reference text,
  transaction_amount numeric(10,2),
  currency_id text,
  provider_payment_id text,
  delivery_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercado_pago_subscription_sandbox_deduplication_key_check
    check (deduplication_key ~ '^[0-9a-f]{64}$'),
  constraint mercado_pago_subscription_sandbox_request_id_check
    check (request_id is null or char_length(request_id) <= 160),
  constraint mercado_pago_subscription_sandbox_provider_event_id_check
    check (provider_event_id is null or char_length(provider_event_id) <= 128),
  constraint mercado_pago_subscription_sandbox_resource_id_check
    check (char_length(provider_resource_id) between 1 and 128),
  constraint mercado_pago_subscription_sandbox_event_type_check
    check (event_type in ('subscription_preapproval', 'subscription_authorized_payment')),
  constraint mercado_pago_subscription_sandbox_action_check
    check (action is null or char_length(action) <= 100),
  constraint mercado_pago_subscription_sandbox_live_mode_check
    check (live_mode = false),
  constraint mercado_pago_subscription_sandbox_signature_check
    check (signature_valid = true),
  constraint mercado_pago_subscription_sandbox_provider_status_check
    check (provider_status is null or char_length(provider_status) <= 80),
  constraint mercado_pago_subscription_sandbox_status_detail_check
    check (provider_status_detail is null or char_length(provider_status_detail) <= 300),
  constraint mercado_pago_subscription_sandbox_reference_check
    check (
      external_reference is null
      or (
        char_length(external_reference) <= 160
        and external_reference like 'sandbox-subscription-%'
      )
    ),
  constraint mercado_pago_subscription_sandbox_amount_check
    check (transaction_amount is null or transaction_amount > 0),
  constraint mercado_pago_subscription_sandbox_currency_check
    check (currency_id is null or currency_id = 'BRL'),
  constraint mercado_pago_subscription_sandbox_payment_id_check
    check (provider_payment_id is null or char_length(provider_payment_id) <= 128),
  constraint mercado_pago_subscription_sandbox_delivery_count_check
    check (delivery_count >= 1)
);

create index if not exists mercado_pago_subscription_sandbox_resource_idx
  on public.mercado_pago_subscription_sandbox_events (
    event_type,
    provider_resource_id,
    last_received_at desc
  );

create index if not exists mercado_pago_subscription_sandbox_reference_idx
  on public.mercado_pago_subscription_sandbox_events (
    external_reference,
    last_received_at desc
  )
  where external_reference is not null;

alter table public.mercado_pago_subscription_sandbox_events enable row level security;

revoke all privileges on table public.mercado_pago_subscription_sandbox_events
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.mercado_pago_subscription_sandbox_events
  to service_role;
