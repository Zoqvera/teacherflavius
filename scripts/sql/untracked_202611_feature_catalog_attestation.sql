-- Read-only catalog proof for immutable, merged November migrations whose
-- effects already exist in production but whose versions have no ledger row.
-- Does not mark them as applied or reexecute billing, attendance or refunds.
select (
  private.is_national_holiday(date '2026-11-15')
  and not private.is_national_holiday(date '2026-11-16')
  and to_regprocedure('public.get_national_holidays(integer)') is not null
  and to_regclass('private.student_financial_responsibilities') is not null
  and to_regclass('private.financial_responsibility_payment_items') is not null
  and (
    select bool_and(
      relrowsecurity
      and not has_table_privilege('anon', oid, 'SELECT')
      and not has_table_privilege('authenticated', oid, 'SELECT')
    )
    from pg_class
    where oid in (
      'private.student_financial_responsibilities'::regclass,
      'private.financial_responsibility_payment_items'::regclass
    )
  )
  and to_regprocedure('private.quote_financial_responsibility_payment(uuid,uuid)') is not null
  and to_regprocedure('public.get_my_financial_responsibility_quote(uuid)') is not null
  and to_regprocedure('public.get_my_financial_responsibility_coverage()') is not null
  and to_regprocedure('private.resume_monthly_billing_after_unarchive()') is not null
  and to_regprocedure('private.end_financial_responsibilities_on_archive()') is not null
  and to_regprocedure('private.guard_sponsored_invoice_manual_settlement()') is not null
  and to_regprocedure('private.assert_financial_payment_group_consistency()') is not null
  and to_regprocedure('public.begin_mercado_pago_refund(uuid,uuid,text)') is not null
  and (
    select count(*) = 3
    from pg_trigger
    where tgname in (
      'archive_student_end_financial_responsibility',
      'resume_monthly_billing_after_unarchive',
      'guard_sponsored_invoice_manual_settlement'
    )
      and tgenabled <> 'D'
  )
  and not has_function_privilege(
    'authenticated', 'public.get_financial_responsibility_payment_quote_internal(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.get_my_financial_responsibility_quote(uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.process_financial_responsibility_payment(uuid,text,text,text,numeric,text,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'EXECUTE'
  )
) as attested;
