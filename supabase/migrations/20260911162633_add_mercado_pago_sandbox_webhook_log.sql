create table public.mercado_pago_sandbox_webhook_events (
  id uuid primary key default gen_random_uuid(),
  deduplication_key text not null unique,
  request_id text,
  provider_event_id text,
  provider_payment_id text not null,
  event_type text not null default 'payment',
  action text,
  live_mode boolean not null default false,
  signature_valid boolean not null default true,
  provider_status text,
  provider_status_detail text,
  external_reference text,
  transaction_amount numeric(12,2),
  delivery_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercado_pago_sandbox_webhook_events_deduplication_key_check
    check (deduplication_key ~ '^[0-9a-f]{64}$'),
  constraint mercado_pago_sandbox_webhook_events_request_id_check
    check (request_id is null or length(request_id) <= 160),
  constraint mercado_pago_sandbox_webhook_events_provider_event_id_check
    check (provider_event_id is null or length(provider_event_id) <= 128),
  constraint mercado_pago_sandbox_webhook_events_provider_payment_id_check
    check (length(provider_payment_id) between 1 and 128),
  constraint mercado_pago_sandbox_webhook_events_event_type_check
    check (event_type = 'payment'),
  constraint mercado_pago_sandbox_webhook_events_action_check
    check (action is null or length(action) <= 100),
  constraint mercado_pago_sandbox_webhook_events_live_mode_check
    check (live_mode = false),
  constraint mercado_pago_sandbox_webhook_events_signature_check
    check (signature_valid = true),
  constraint mercado_pago_sandbox_webhook_events_provider_status_check
    check (provider_status is null or length(provider_status) <= 50),
  constraint mercado_pago_sandbox_webhook_events_provider_status_detail_check
    check (provider_status_detail is null or length(provider_status_detail) <= 160),
  constraint mercado_pago_sandbox_webhook_events_external_reference_check
    check (external_reference is null or length(external_reference) <= 200),
  constraint mercado_pago_sandbox_webhook_events_transaction_amount_check
    check (transaction_amount is null or transaction_amount > 0),
  constraint mercado_pago_sandbox_webhook_events_delivery_count_check
    check (delivery_count >= 1),
  constraint mercado_pago_sandbox_webhook_events_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.mercado_pago_sandbox_webhook_events enable row level security;
revoke all on table public.mercado_pago_sandbox_webhook_events from public, anon, authenticated;
grant select, insert, update on table public.mercado_pago_sandbox_webhook_events to service_role;

create index mercado_pago_sandbox_webhook_events_payment_idx
  on public.mercado_pago_sandbox_webhook_events (provider_payment_id, last_received_at desc);

create index mercado_pago_sandbox_webhook_events_received_idx
  on public.mercado_pago_sandbox_webhook_events (last_received_at desc);
