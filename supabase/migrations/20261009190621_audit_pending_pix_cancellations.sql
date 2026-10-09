-- Operational audit of admin requests to cancel still-unpaid Mercado Pago Pix.
-- No student or billing data is mutated by this table.
create table public.payment_cancellation_audit (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.tuition_payment_attempts(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  provider_payment_id text not null,
  outcome text not null check (outcome in (
    'requested', 'confirmed', 'already_cancelled', 'blocked', 'failed', 'uncertain'
  )),
  provider_status text,
  error_code text,
  created_at timestamptz not null default now()
);

create index payment_cancellation_audit_attempt_created_idx
  on public.payment_cancellation_audit(attempt_id, created_at desc);

alter table public.payment_cancellation_audit enable row level security;
revoke all on public.payment_cancellation_audit from public, anon, authenticated;
grant select, insert on public.payment_cancellation_audit to service_role;
