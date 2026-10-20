-- Local, disposable Supabase restore only. No external providers or real students.
begin;
do $assertions$
declare
  config_enabled boolean;
  processor text;
begin
  select enabled into config_enabled
  from private.late_payment_charge_settings
  where singleton = true;
  if config_enabled is distinct from false then
    raise exception 'Late-payment feature must be disabled by default.';
  end if;

  if not exists (
    select 1 from pg_class t join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private' and t.relname = 'late_payment_charge_settings'
      and t.relrowsecurity
  ) then
    raise exception 'Private payment-flag table must use RLS.';
  end if;

  if has_table_privilege('anon', 'private.late_payment_charge_settings', 'SELECT')
     or has_table_privilege('authenticated', 'private.late_payment_charge_settings', 'UPDATE')
     or has_function_privilege('authenticated',
         'public.get_checkout_late_tuition_quote(uuid)', 'EXECUTE')
     or has_function_privilege('anon',
         'public.get_checkout_late_tuition_quote(uuid)', 'EXECUTE')
  then
    raise exception 'Unexpected access to financial quote or control.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tuition_payment_attempts'
      and column_name='late_principal_amount'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='monthly_tuition'
      and column_name='late_fine_paid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='monthly_tuition'
      and column_name='late_interest_paid'
  ) then
    raise exception 'Missing immutable fee snapshots or settlement breakdown.';
  end if;

  select pg_get_functiondef(
    'public.process_mercado_pago_payment(uuid,text,text,text,numeric,text,boolean,timestamptz,timestamptz,timestamptz)'::regprocedure
  ) into processor;
  if position('late_principal_amount' in processor) = 0
     or position('late_fine_paid = null' in processor) = 0
     or position('late_interest_paid = null' in processor) = 0 then
    raise exception 'Provider settlement or reversal lacks late-fee support.';
  end if;

  -- Repeated fee estimates must never be persisted on monthly_tuition.
  if exists(
    select 1 from public.monthly_tuition
    where late_fine_paid is not null or late_interest_paid is not null
  ) then
    raise exception 'Restored schema unexpectedly includes settled charges.';
  end if;
end;
$assertions$;
rollback;
