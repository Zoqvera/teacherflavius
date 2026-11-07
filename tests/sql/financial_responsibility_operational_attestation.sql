-- Read-only production health attestation for consolidated tuition.
-- Reports only booleans and counts; never creates fake students or payments.
select
  exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.profiles'::regclass
      and t.tgname='archive_student_end_financial_responsibility'
      and t.tgenabled='O'
  ) as archives_end_sponsorship,
  exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.profiles'::regclass
      and t.tgname='resume_monthly_billing_after_unarchive'
      and t.tgenabled='O'
  ) as unarchive_resumes_billing,
  exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.monthly_tuition'::regclass
      and t.tgname='assert_financial_payment_group_consistency'
      and t.tgdeferrable and t.tginitdeferred and t.tgenabled='O'
  ) as payment_group_consistency_deferred,
  exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.monthly_tuition'::regclass
      and t.tgname='guard_sponsored_invoice_manual_settlement'
      and t.tgenabled='O'
  ) as manual_split_payment_guarded,
  not has_table_privilege('authenticated','private.student_financial_responsibilities','select') as private_sponsorship_hidden,
  not has_table_privilege('authenticated','private.financial_responsibility_payment_items','select') as private_group_items_hidden,
  not has_function_privilege('authenticated','public.process_financial_responsibility_payment(uuid,text,text,text,numeric,text,boolean,timestamptz,timestamptz,timestamptz)','execute') as settlement_server_only,
  pg_get_functiondef('public.begin_mercado_pago_refund(uuid,uuid,text)'::regprocedure) like '%total_refund_amount%' as full_transaction_refunds,
  pg_get_functiondef('public.list_mercado_pago_refund_candidates(date)'::regprocedure) like '%attempt.amount else tuition.amount_paid%' as refund_list_shows_full_amount,
  pg_get_functiondef('public.end_teacher_financial_responsibility(uuid,date)'::regprocedure) like '%Há mensalidades pagas nesse período%' as paid_history_protected,
  pg_get_functiondef('public.set_teacher_financial_responsibility(uuid,uuid,date,text)'::regprocedure) like '%count(distinct billing.due_day)%' as due_day_alignment_enforced,
  (select count(*) from private.student_financial_responsibilities) as registered_financial_links,
  (select count(*) from private.financial_responsibility_payment_items) as reserved_group_items;
