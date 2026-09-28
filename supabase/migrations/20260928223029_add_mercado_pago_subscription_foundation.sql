create table public.student_subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'mercado_pago',
  provider_subscription_id text,
  external_reference uuid not null default gen_random_uuid(),
  idempotency_key uuid not null default gen_random_uuid(),
  status text not null default 'draft',
  amount numeric(10,2) not null,
  currency_id text not null default 'BRL',
  frequency smallint not null default 1,
  frequency_type text not null default 'months',
  due_day smallint not null,
  first_charge_date date not null,
  next_payment_date timestamptz,
  payer_email text not null,
  provider_payer_id text,
  payment_method_id text,
  live_mode boolean,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  started_at timestamptz,
  paused_at timestamptz,
  cancelled_at timestamptz,
  last_provider_error_code text,
  last_provider_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_subscriptions_provider_check
    check (provider = 'mercado_pago'),
  constraint student_subscriptions_status_check
    check (status in ('draft', 'pending', 'authorized', 'paused', 'cancelled')),
  constraint student_subscriptions_amount_check
    check (amount > 0),
  constraint student_subscriptions_currency_check
    check (currency_id = 'BRL'),
  constraint student_subscriptions_frequency_check
    check (frequency = 1 and frequency_type = 'months'),
  constraint student_subscriptions_due_day_check
    check (due_day between 1 and 31),
  constraint student_subscriptions_payer_email_check
    check (char_length(trim(payer_email)) between 3 and 320),
  constraint student_subscriptions_provider_id_length_check
    check (provider_subscription_id is null or char_length(provider_subscription_id) <= 128),
  constraint student_subscriptions_payment_method_length_check
    check (payment_method_id is null or char_length(payment_method_id) <= 80),
  constraint student_subscriptions_error_code_length_check
    check (last_provider_error_code is null or char_length(last_provider_error_code) <= 120),
  unique (external_reference),
  unique (idempotency_key),
  unique (provider, provider_subscription_id)
);

create unique index student_subscriptions_one_current_per_student_idx
  on public.student_subscriptions (student_id)
  where status in ('draft', 'pending', 'authorized', 'paused');

create index student_subscriptions_provider_status_idx
  on public.student_subscriptions (provider, status, updated_at desc);

create index student_subscriptions_next_payment_idx
  on public.student_subscriptions (next_payment_date)
  where status = 'authorized' and next_payment_date is not null;

create or replace function public.set_student_subscription_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists student_subscriptions_set_updated_at
  on public.student_subscriptions;

create trigger student_subscriptions_set_updated_at
before update on public.student_subscriptions
for each row execute function public.set_student_subscription_updated_at();

alter table public.student_subscriptions enable row level security;

revoke all privileges on table public.student_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.student_subscriptions to service_role;

revoke all on function public.set_student_subscription_updated_at()
  from public, anon, authenticated;
grant execute on function public.set_student_subscription_updated_at()
  to service_role;
