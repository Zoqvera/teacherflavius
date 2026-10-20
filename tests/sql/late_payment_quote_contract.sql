-- Executed only against disposable CI PostgreSQL.
-- All fixtures are numerical values; no real student or payment is created.
do $test$
declare
  result jsonb;
begin
  result := private.calculate_late_payment_components(
    100, date '2026-10-20', date '2026-10-20', date '2026-10-20'
  );
  if (result ->> 'total_amount')::numeric <> 100
     or (result ->> 'chargeable_days')::integer <> 0 then
    raise exception 'No fee or interest is permitted on the due date.';
  end if;

  result := private.calculate_late_payment_components(
    100, date '2026-10-01', date '2026-10-20', date '2026-10-30'
  );
  if (result ->> 'chargeable_days')::integer <> 10
     or (result ->> 'fine_amount')::numeric <> 2
     or (result ->> 'interest_amount')::numeric <> 0.33
     or (result ->> 'total_amount')::numeric <> 102.33 then
    raise exception 'Existing arrears must not be charged retroactively.';
  end if;

  result := private.calculate_late_payment_components(
    50, date '2026-10-01', date '2026-10-01', date '2026-10-31'
  );
  if (result ->> 'fine_amount')::numeric <> 1
     or (result ->> 'interest_amount')::numeric <> 0.5
     or (result ->> 'total_amount')::numeric <> 51.5 then
    raise exception 'Fine and simple interest computation failed.';
  end if;

  result := private.calculate_late_payment_components(
    100, date '2026-11-10', date '2026-10-20', date '2026-10-25'
  );
  if (result ->> 'total_amount')::numeric <> 100 then
    raise exception 'Future tuition cannot be charged before due date.';
  end if;

  if has_function_privilege('anon','public.get_my_late_payment_terms()','EXECUTE')
     or has_function_privilege('anon','public.accept_my_late_payment_terms(text)','EXECUTE')
     or has_function_privilege('anon','public.get_my_late_tuition_quote(uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.get_tuition_late_payment_quote(uuid,date)','EXECUTE')
  then
    raise exception 'Late-payment functions are exposed to the wrong roles.';
  end if;
end;
$test$;
