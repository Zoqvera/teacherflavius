-- Backfill the single reviewed, historically settled Pix distributed between
-- two tuition periods. A fresh or restored database without this case is a no-op.
do $repair$
declare
  attempt_row record;
  october_row record;
  matching_count integer;
begin
  select count(*) into matching_count
  from public.tuition_payment_attempts attempt
  join public.monthly_tuition september on september.id = attempt.tuition_id
  join public.monthly_tuition october
    on october.student_id = attempt.student_id
   and october.reference_month = date '2026-10-01'
  where september.reference_month = date '2026-09-01'
    and attempt.status = 'approved'
    and attempt.payment_method = 'pix'
    and attempt.amount = 100
    and attempt.reconciliation_failure_count = 1
    and september.amount_due = 50
    and september.amount_paid = 100
    and september.payment_provider = 'mercado_pago'
    and september.provider_payment_id = attempt.provider_payment_id
    and october.amount_due = 50
    and october.amount_paid = 50
    and october.payment_method = 'other'
    and october.payment_provider is null
    and exists (
      select 1 from public.tuition_payment_attempts card
      where card.tuition_id = october.id
        and card.status = 'refunded'
        and card.payment_method = 'card'
        and card.amount = 100
        and card.reversed_at is not null
    );

  if matching_count = 0 then
    return;
  end if;
  if matching_count <> 1 then
    raise exception 'Ambiguous historical split allocation; no records changed';
  end if;

  select attempt.id as attempt_id, september.id as september_id,
         september.student_id, attempt.applied_at,
         attempt.reversed_at, attempt.provider_payment_id
    into strict attempt_row
  from public.tuition_payment_attempts attempt
  join public.monthly_tuition september on september.id = attempt.tuition_id
  where september.reference_month = date '2026-09-01'
    and attempt.status = 'approved'
    and attempt.payment_method = 'pix'
    and attempt.amount = 100
    and attempt.reconciliation_failure_count = 1
    and september.amount_due = 50
    and september.amount_paid = 100
  for update of attempt, september;

  select * into strict october_row
  from public.monthly_tuition tuition
  where tuition.student_id = attempt_row.student_id
    and tuition.reference_month = date '2026-10-01'
  for update;

  if attempt_row.applied_at is null or attempt_row.reversed_at is not null
    or attempt_row.provider_payment_id is null
    or october_row.amount_due <> 50 or october_row.amount_paid <> 50
    or october_row.payment_date is null or october_row.payment_method <> 'other'
    or october_row.payment_provider is not null
    or exists (
      select 1 from private.mercado_pago_tuition_allocations allocation
      where allocation.attempt_id = attempt_row.attempt_id
        or allocation.tuition_id in (attempt_row.september_id, october_row.id)
    )
  then
    raise exception 'Historical split state has changed unexpectedly';
  end if;

  update public.monthly_tuition
  set amount_paid = 50,
      payment_notes = 'Pix R$100: R$50 alocados a setembro e R$50 a outubro; transação original preservada.',
      updated_at = now(), updated_by = null
  where id = attempt_row.september_id;

  update public.monthly_tuition
  set payment_method = 'pix',
      payment_notes = 'R$50 do Pix de setembro alocados a outubro; cobrança por cartão integralmente estornada.',
      updated_at = now(), updated_by = null
  where id = october_row.id;

  insert into private.mercado_pago_tuition_allocations (attempt_id, tuition_id, allocated_amount)
  values (attempt_row.attempt_id, attempt_row.september_id, 50),
         (attempt_row.attempt_id, october_row.id, 50);

  if not private.has_valid_mercado_pago_split(attempt_row.attempt_id) then
    raise exception 'Failed to verify the split allocation, transaction rolled back';
  end if;

  update public.tuition_payment_attempts
  set reconciliation_failure_count = 0, last_reconciliation_error = null
  where id = attempt_row.attempt_id;
end;
$repair$;
