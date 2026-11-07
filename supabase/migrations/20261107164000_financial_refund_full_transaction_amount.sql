-- Stage 4: consolidated provider refunds must be shown at full
-- transaction amount and validated against every covered invoice.
CREATE OR REPLACE FUNCTION public.begin_mercado_pago_refund(target_tuition_id uuid, target_actor_id uuid, target_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  tuition_row public.monthly_tuition%rowtype;
  attempt_row public.tuition_payment_attempts%rowtype;
  refund_row public.payment_refund_requests%rowtype;
  normalized_reason text := nullif(left(trim(coalesce(target_reason, '')), 500), '');
  total_refund_amount numeric(10,2);
  item_count integer;
  item_total numeric(10,2);
  items_consistent boolean;
begin
  if target_tuition_id is null or target_actor_id is null then
    raise exception 'Dados obrigatórios ausentes.' using errcode = '22023';
  end if;

  select *
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id
  for update;

  if not found then
    raise exception 'Mensalidade não encontrada.' using errcode = 'P0002';
  end if;

  if tuition_row.payment_date is null
     or tuition_row.payment_provider is distinct from 'mercado_pago'
     or nullif(trim(coalesce(tuition_row.provider_payment_id, '')), '') is null then
    raise exception 'Esta mensalidade não possui pagamento Mercado Pago elegível a reembolso.' using errcode = '22023';
  end if;

  select *
  into attempt_row
  from public.tuition_payment_attempts attempt
  where attempt.tuition_id = tuition_row.id
    and attempt.provider = 'mercado_pago'
    and attempt.provider_payment_id = tuition_row.provider_payment_id
  order by attempt.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Tentativa Mercado Pago vinculada não encontrada.' using errcode = 'P0002';
  end if;

  if attempt_row.status <> 'approved'
     or attempt_row.applied_at is null
     or attempt_row.reversed_at is not null then
    raise exception 'O pagamento não está em estado elegível para reembolso integral.' using errcode = '22023';
  end if;

  -- An allocated payment settles multiple tuition invoices. The refund
  -- must be quoted and validated against the full gateway transaction.
  select count(*), round(coalesce(sum(item.allocated_amount),0),2),
         coalesce(bool_and(
           item.reversed_at is null
           and invoice.payment_date is not null
           and not invoice.is_exempt
           and round(invoice.amount_paid,2) = round(item.allocated_amount,2)
         ),false)
  into item_count,item_total,items_consistent
  from private.financial_responsibility_payment_items item
  join public.monthly_tuition invoice on invoice.id=item.tuition_id
  where item.attempt_id=attempt_row.id;

  if item_count > 0 and (
     item_count < 2
     or item_total is distinct from round(attempt_row.amount,2)
     or not items_consistent
  ) then
    raise exception 'As mensalidades vinculadas não estão conciliadas para reembolso integral.'
      using errcode='22023';
  end if;

  total_refund_amount := case when item_count > 0
    then round(attempt_row.amount,2)
    else round(tuition_row.amount_paid,2)
  end;

  select *
  into refund_row
  from public.payment_refund_requests request
  where request.provider_payment_id = tuition_row.provider_payment_id
  for update;

  if not found then
    insert into public.payment_refund_requests (
      tuition_id,
      attempt_id,
      provider_payment_id,
      requested_by,
      reason
    ) values (
      tuition_row.id,
      attempt_row.id,
      tuition_row.provider_payment_id,
      target_actor_id,
      normalized_reason
    )
    returning * into refund_row;
  end if;

  if refund_row.status = 'synchronized' then
    return jsonb_build_object(
      'ok', true,
      'already_complete', true,
      'busy', false,
      'skip_provider_call', true,
      'request_id', refund_row.id,
      'attempt_id', refund_row.attempt_id,
      'provider_payment_id', refund_row.provider_payment_id,
      'idempotency_key', refund_row.idempotency_key,
      'amount', total_refund_amount,
      'status', refund_row.status
    );
  end if;

  if refund_row.status = 'processing'
     and refund_row.started_at is not null
     and refund_row.started_at > now() - interval '2 minutes' then
    return jsonb_build_object(
      'ok', true,
      'already_complete', false,
      'busy', true,
      'skip_provider_call', false,
      'request_id', refund_row.id,
      'attempt_id', refund_row.attempt_id,
      'provider_payment_id', refund_row.provider_payment_id,
      'idempotency_key', refund_row.idempotency_key,
      'amount', total_refund_amount,
      'status', refund_row.status
    );
  end if;

  if refund_row.status = 'provider_accepted' then
    update public.payment_refund_requests
    set
      requested_by = coalesce(requested_by, target_actor_id),
      reason = coalesce(normalized_reason, reason),
      updated_at = now()
    where id = refund_row.id
    returning * into refund_row;

    return jsonb_build_object(
      'ok', true,
      'already_complete', false,
      'busy', false,
      'skip_provider_call', true,
      'request_id', refund_row.id,
      'attempt_id', refund_row.attempt_id,
      'provider_payment_id', refund_row.provider_payment_id,
      'idempotency_key', refund_row.idempotency_key,
      'amount', total_refund_amount,
      'status', refund_row.status
    );
  end if;

  update public.payment_refund_requests
  set
    status = 'processing',
    requested_by = coalesce(requested_by, target_actor_id),
    reason = coalesce(normalized_reason, reason),
    attempt_count = attempt_count + 1,
    started_at = now(),
    last_error = null,
    updated_at = now()
  where id = refund_row.id
  returning * into refund_row;

  return jsonb_build_object(
    'ok', true,
    'already_complete', false,
    'busy', false,
    'skip_provider_call', false,
    'request_id', refund_row.id,
    'attempt_id', refund_row.attempt_id,
    'provider_payment_id', refund_row.provider_payment_id,
    'idempotency_key', refund_row.idempotency_key,
    'amount', total_refund_amount,
    'status', refund_row.status
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.list_mercado_pago_refund_candidates(target_reference_month date)
 RETURNS TABLE(tuition_id uuid, provider_payment_id text, attempt_id uuid, amount_paid numeric, payment_method text, payment_date date, refund_status text, refund_attempt_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    tuition.id,
    tuition.provider_payment_id,
    attempt.id,
    case when exists (
      select 1 from private.financial_responsibility_payment_items item
      where item.attempt_id=attempt.id
    ) then attempt.amount else tuition.amount_paid end,
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
$function$;
