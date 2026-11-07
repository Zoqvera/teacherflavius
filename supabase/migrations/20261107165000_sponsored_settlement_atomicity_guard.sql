-- Sponsored invoices are one atomic financial unit. Manual one-off payment,
-- exemption and single-invoice reversal cannot silently break that unit.
create or replace function private.guard_sponsored_invoice_manual_settlement()
returns trigger language plpgsql security definer set search_path = ''
as $body$
begin
  if new.payment_date is not distinct from old.payment_date
     and new.amount_paid is not distinct from old.amount_paid
     and new.is_exempt is not distinct from old.is_exempt then
    return new;
  end if;

  if not exists (
    select 1 from private.student_financial_responsibilities link
    where link.state <> 'cancelled'
      and link.first_reference_month <= new.reference_month
      and (link.first_uncovered_month is null
           or new.reference_month < link.first_uncovered_month)
      and new.student_id in (link.payer_student_id,link.beneficiary_student_id)
  ) then
    return new;
  end if;

  if not exists (
    select 1 from private.financial_responsibility_payment_items item
    where item.tuition_id = new.id
  ) then
    raise exception 'Esta mensalidade integra uma cobrança consolidada. Faça a quitação ou estorno da transação inteira.'
      using errcode = '23514';
  end if;

  return new;
end;
$body$;

drop trigger if exists guard_sponsored_invoice_manual_settlement on public.monthly_tuition;
create trigger guard_sponsored_invoice_manual_settlement
  before update of payment_date,amount_paid,is_exempt on public.monthly_tuition
  for each row execute function private.guard_sponsored_invoice_manual_settlement();

create or replace function private.assert_financial_payment_group_consistency()
returns trigger language plpgsql security definer set search_path = ''
as $body$
declare
  group_record record;
begin
  for group_record in
    select item.attempt_id
    from private.financial_responsibility_payment_items item
    where item.tuition_id = new.id
  loop
    if exists (
      select 1
      from private.financial_responsibility_payment_items item
      join public.monthly_tuition invoice on invoice.id=item.tuition_id
      where item.attempt_id=group_record.attempt_id
      group by item.attempt_id
      having count(*) filter (where invoice.payment_date is not null) > 0
         and count(*) filter (where invoice.payment_date is not null) < count(*)
    ) then
      raise exception 'Pagamento consolidado parcialmente quitado: operação financeira revertida.'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from private.financial_responsibility_payment_items item
      join public.monthly_tuition invoice on invoice.id=item.tuition_id
      where item.attempt_id=group_record.attempt_id
        and invoice.payment_date is not null
        and (
          invoice.is_exempt
          or invoice.amount_paid is null
          or round(invoice.amount_paid,2) <> round(item.allocated_amount,2)
        )
    ) then
      raise exception 'Valores divergentes no rateio de uma cobrança consolidada.'
        using errcode='23514';
    end if;
  end loop;
  return null;
end;
$body$;

-- Evaluated at transaction COMMIT: the payment gateway may legitimately
-- update the two student invoices sequentially within one transaction.
drop trigger if exists assert_financial_payment_group_consistency on public.monthly_tuition;
create constraint trigger assert_financial_payment_group_consistency
  after update of payment_date,amount_paid,is_exempt on public.monthly_tuition
  deferrable initially deferred
  for each row execute function private.assert_financial_payment_group_consistency();

revoke all on function private.guard_sponsored_invoice_manual_settlement()
  from public,anon,authenticated;
revoke all on function private.assert_financial_payment_group_consistency()
  from public,anon,authenticated;
