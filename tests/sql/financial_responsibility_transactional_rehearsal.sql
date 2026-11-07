-- Disposable Supabase CI only. DO NOT run against production.
-- All fixture rows are synthetic, all external calls are forbidden by design.
-- Surround this test with BEGIN/ROLLBACK after restoring the baseline.
set local session_replication_role = replica;

-- Suppress application notification triggers only during fixture insertion.
insert into public.profiles (
  id, name, enrolled, archived, enrolled_at, tuition_first_due_date,
  first_payment_same_day_required
) values
  ('a7100000-0000-4000-8000-000000000001', 'CI Synthetic Payer', true, false,
    date_trunc('month',now()) - interval '2 months',
    (date_trunc('month',now())+interval '10 days')::date, false),
  ('a7100000-0000-4000-8000-000000000002', 'CI Synthetic Beneficiary', true, false,
    date_trunc('month',now()) - interval '2 months',
    (date_trunc('month',now())+interval '10 days')::date, false);

insert into public.student_billing_settings (
  student_id, monthly_fee, due_day, billing_start_month,
  active, classes_per_month, billing_plan_id
) values
  ('a7100000-0000-4000-8000-000000000001', 50, 11,
    date_trunc('month',now())::date, true, 4, (select id from private.billing_plans where code='standard_50_4')),
  ('a7100000-0000-4000-8000-000000000002', 50, 11,
    date_trunc('month',now())::date, true, 4, (select id from private.billing_plans where code='standard_50_4'));

insert into private.student_financial_responsibilities (
  id, payer_student_id, beneficiary_student_id, first_reference_month, state
) values (
  'a7100000-0000-4000-8000-000000000003',
  'a7100000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000002',
  date_trunc('month',now())::date, 'active'
);

insert into public.monthly_tuition (
  id, student_id, subject_ref, reference_month, due_date, amount_due
) values
  ('a7100000-0000-4000-8000-000000000004',
    'a7100000-0000-4000-8000-000000000001',
    'a7100000-0000-4000-8000-000000000001',
    date_trunc('month',now())::date,
    (date_trunc('month',now())+interval '10 days')::date, 50),
  ('a7100000-0000-4000-8000-000000000005',
    'a7100000-0000-4000-8000-000000000002',
    'a7100000-0000-4000-8000-000000000002',
    date_trunc('month',now())::date,
    (date_trunc('month',now())+interval '10 days')::date, 50);

set local session_replication_role = origin;

do $trial$
declare
  quote jsonb;
begin
  quote := private.quote_financial_responsibility_payment(
    'a7100000-0000-4000-8000-000000000001',
    'a7100000-0000-4000-8000-000000000004'
  );
  if (quote->>'total')::numeric <> 100
     or (quote->>'sponsored')::boolean is distinct from true
     or jsonb_array_length(quote->'items') <> 2 then
    raise exception 'Consolidated quote is not 50 + 50 = 100: %', quote;
  end if;

  if not exists (
    select 1 from jsonb_array_elements(quote->'items') item
    where (item->>'student_id')::uuid='a7100000-0000-4000-8000-000000000002'
      and (item->>'amount')::numeric = 50
  ) then
    raise exception 'Beneficiary package is missing from the payer quotation';
  end if;
end;
$trial$;

-- The provider-creation gate is separately covered by existing gateway tests.
-- The isolated scenario injects the provider attempt with notifications disabled.
set local session_replication_role = replica;
insert into public.tuition_payment_attempts (
  id, tuition_id, student_id, subject_ref,
  idempotency_key, amount, status, provider
) values (
  'a7100000-0000-4000-8000-000000000006',
  'a7100000-0000-4000-8000-000000000004',
  'a7100000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001',
  'ci-synthetic-sponsorship-approved-001',
  100, 'created','mercado_pago'
);
set local session_replication_role = origin;

do $trial$
declare
  reservation jsonb;
  result jsonb;
begin
  reservation := public.reserve_financial_responsibility_payment(
    'a7100000-0000-4000-8000-000000000006',
    'a7100000-0000-4000-8000-000000000001'
  );
  if reservation->>'total' <> '100.00'
    and (reservation->>'total')::numeric <> 100 then
    raise exception 'Incorrect reservation total: %',reservation;
  end if;
  if (reservation->>'items')::int <> 2 then
    raise exception 'Expected exactly two immutable tuition allocations: %', reservation;
  end if;

  -- Fake provider ID and status, directly through the same DB gateway
  -- used by the real webhook. No HTTP request to Mercado Pago is made.
  result := public.process_mercado_pago_payment(
    'a7100000-0000-4000-8000-000000000006',
    'ci-synthetic-provider-approval-001','approved','accredited',
    100,'pix',false,now(),now(),now()
  );
  if (result->>'newly_settled')::int <> 2 then
    raise exception 'Consolidated payment did not settle both invoices: %',result;
  end if;
end;
$trial$;

-- Force the deferred transactional group invariant now, before rollback.
set constraints all immediate;
set constraints all deferred;

do $trial$
declare
  paid_count integer;
  total_paid numeric;
  credit_count integer;
  primary_payment_ids integer;
begin
  select count(*),sum(amount_paid),count(provider_payment_id)
  into paid_count,total_paid,primary_payment_ids
  from public.monthly_tuition
  where id in (
    'a7100000-0000-4000-8000-000000000004',
    'a7100000-0000-4000-8000-000000000005'
  ) and payment_date is not null;

  if paid_count <> 2 or total_paid <> 100 or primary_payment_ids <> 1 then
    raise exception 'Settlement mismatch: invoices %, paid %, provider IDs %',
      paid_count,total_paid,primary_payment_ids;
  end if;

  select count(*) into credit_count
  from private.lesson_credits
  where tuition_id in (
    'a7100000-0000-4000-8000-000000000004',
    'a7100000-0000-4000-8000-000000000005'
  ) and revoked_at is null and credit_origin='contract';
  if credit_count <> 8 then
    raise exception 'Expected four independent credits for each of two students, found %',
      credit_count;
  end if;

  if exists (
    select 1 from private.lesson_credits
    where tuition_id in (
      'a7100000-0000-4000-8000-000000000004',
      'a7100000-0000-4000-8000-000000000005'
    )
    group by student_id having count(*) <> 4
  ) then raise exception 'Credit distribution across students is not 4+4'; end if;
end;
$trial$;

do $trial$
declare repeated jsonb;
begin
  repeated := public.process_mercado_pago_payment(
    'a7100000-0000-4000-8000-000000000006',
    'ci-synthetic-provider-approval-001','approved','accredited',
    100,'pix',false,now(),now(),now()
  );
  if (repeated->>'newly_settled')::int <> 0 then
    raise exception 'Repeated approved notification settled invoices again: %',repeated;
  end if;
  if (select count(*) from private.lesson_credits
      where tuition_id in (
        'a7100000-0000-4000-8000-000000000004',
        'a7100000-0000-4000-8000-000000000005'
      )) <> 8 then
    raise exception 'Duplicate notification created extra credits';
  end if;
end;
$trial$;

do $trial$
declare refund jsonb;
begin
  refund := public.process_mercado_pago_payment(
    'a7100000-0000-4000-8000-000000000006',
    'ci-synthetic-provider-approval-001','refunded','refunded',
    100,'pix',false,now(),now(),null
  );
  if (refund->>'newly_reversed')::int <> 2 then
    raise exception 'Consolidated refund did not reverse both invoices: %',refund;
  end if;

  if exists (
    select 1 from public.monthly_tuition
    where id in (
      'a7100000-0000-4000-8000-000000000004',
      'a7100000-0000-4000-8000-000000000005'
    ) and (payment_date is not null or amount_paid is not null)
  ) then raise exception 'One of the covered invoices remained settled'; end if;

  if (select count(*) from private.lesson_credits
    where tuition_id in (
      'a7100000-0000-4000-8000-000000000004',
      'a7100000-0000-4000-8000-000000000005'
    ) and revoked_at is not null) <> 8 then
    raise exception 'Refund did not revoke all eight contractual credits';
  end if;
end;
$trial$;

-- A refund must not leave one settled invoice behind at transaction end.
set constraints all immediate;
set constraints all deferred;

do $trial$
declare repeat_refund jsonb;
begin
  repeat_refund := public.process_mercado_pago_payment(
    'a7100000-0000-4000-8000-000000000006',
    'ci-synthetic-provider-approval-001','refunded','refunded',
    100,'pix',false,now(),now(),null
  );
  if (repeat_refund->>'newly_reversed')::int <> 0 then
    raise exception 'Duplicate refund should not reverse invoices twice';
  end if;
end;
$trial$;

do $trial$
declare replay_rejected boolean := false;
begin
  begin
    perform public.process_mercado_pago_payment(
      'a7100000-0000-4000-8000-000000000006',
      'ci-synthetic-provider-approval-001','approved','accredited',
      100,'pix',false,now(),now(),now()
    );
  exception when others then
    replay_rejected := true;
  end;
  if not replay_rejected then
    raise exception 'An already-refunded payment was improperly reapproved';
  end if;
end;
$trial$;

select 'SPONSORSHIP_SYNTHETIC_TRANSACTIONAL_REHEARSAL_PASSED' as result;
