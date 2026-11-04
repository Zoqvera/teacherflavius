-- Run only in an isolated database after applying create_payment_agent_role.
begin;
do $$
begin
  if not has_function_privilege('teacher_payment_agent',
    'public.record_tuition_payment(uuid,date,numeric,text,text)', 'EXECUTE') then
    raise exception 'Payment function is not available';
  end if;
  if has_function_privilege('teacher_payment_agent',
    'public.reverse_tuition_payment(uuid,text)', 'EXECUTE') then
    raise exception 'Payment reversal must not be available';
  end if;
  if has_table_privilege('teacher_payment_agent', 'public.monthly_tuition', 'UPDATE')
    or has_table_privilege('teacher_payment_agent', 'public.monthly_tuition', 'SELECT') then
    raise exception 'Direct financial table access must not be available';
  end if;
  if pg_has_role('teacher_payment_agent', 'authenticated', 'member') then
    raise exception 'Application role must not be inherited';
  end if;
end;
$$;
rollback;
