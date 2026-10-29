-- Distinguish a manual Pix refund from a provider refund.
-- Never mark an approved Mercado Pago payment as refunded without provider confirmation.

alter table public.payment_refund_requests
  add column if not exists manual_refund_amount numeric(12, 2),
  add column if not exists manual_refund_date date,
  add column if not exists manual_refund_method text,
  add column if not exists manual_refund_recorded_at timestamptz,
  add column if not exists manual_refund_note text;

alter table public.payment_refund_requests
  drop constraint if exists payment_refund_requests_status_check;

alter table public.payment_refund_requests
  add constraint payment_refund_requests_status_check
  check (status in (
    'created', 'processing', 'provider_accepted', 'synchronized',
    'failed', 'manually_settled'
  ));

alter table public.payment_refund_requests
  add constraint payment_refund_requests_manual_settlement_check
  check (
    status <> 'manually_settled'
    or (
      manual_refund_amount > 0
      and manual_refund_date is not null
      and manual_refund_method = 'pix'
      and manual_refund_recorded_at is not null
    )
  );

-- Preserve the manual settlement as a terminal state, even if an old
-- administrative client retries the original Mercado Pago refund request.
create or replace function private.prevent_manual_refund_reprocessing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'manually_settled'
     and new.status is distinct from 'manually_settled' then
    raise exception 'Reembolso ja liquidado manualmente por Pix: nova operacao do provedor bloqueada.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger prevent_manual_refund_reprocessing
before update of status on public.payment_refund_requests
for each row execute function private.prevent_manual_refund_reprocessing();

-- Paid-back cases must not present the "retry provider refund" button.
create or replace function public.list_mercado_pago_refund_candidates(target_reference_month date)
returns table(
  tuition_id uuid,
  provider_payment_id text,
  attempt_id uuid,
  amount_paid numeric,
  payment_method text,
  payment_date date,
  refund_status text,
  refund_attempt_count integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    tuition.id,
    tuition.provider_payment_id,
    attempt.id,
    tuition.amount_paid,
    tuition.payment_method,
    tuition.payment_date,
    refund.status,
    coalesce(refund.attempt_count, 0)
  from public.monthly_tuition tuition
  join lateral (
    select candidate.*
    from public.tuition_payment_attempts candidate
    where candidate.tuition_id = tuition.id
      and candidate.provider = 'mercado_pago'
      and candidate.provider_payment_id = tuition.provider_payment_id
    order by candidate.created_at desc
    limit 1
  ) attempt on true
  left join public.payment_refund_requests refund
    on refund.provider_payment_id = tuition.provider_payment_id
  where tuition.reference_month = date_trunc('month', coalesce(target_reference_month, current_date))::date
    and tuition.payment_date is not null
    and tuition.payment_provider = 'mercado_pago'
    and tuition.provider_payment_id is not null
    and attempt.status = 'approved'
    and attempt.applied_at is not null
    and attempt.reversed_at is null
    and refund.status is distinct from 'manually_settled'
  order by tuition.payment_date desc, tuition.id;
$$;
