create index if not exists payment_refund_requests_tuition_id_idx
  on public.payment_refund_requests(tuition_id);
create index if not exists payment_refund_requests_attempt_id_idx
  on public.payment_refund_requests(attempt_id);
create index if not exists payment_refund_requests_requested_by_idx
  on public.payment_refund_requests(requested_by)
  where requested_by is not null;

drop function if exists public.get_teacher_mercado_pago_refund_candidates(date);

create or replace function public.list_mercado_pago_refund_candidates(
  target_reference_month date
)
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
set search_path = public, pg_temp
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
  order by tuition.payment_date desc, tuition.id;
$$;

revoke all on function public.list_mercado_pago_refund_candidates(date) from public, anon, authenticated;
grant execute on function public.list_mercado_pago_refund_candidates(date) to service_role;
