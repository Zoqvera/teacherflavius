-- Read-only production verification; never creates or alters sponsorships.
select
  to_regclass('private.student_financial_responsibilities') is not null as table_exists,
  (select relrowsecurity from pg_class
   where oid = 'private.student_financial_responsibilities'::regclass) as rls_enabled,
  not has_table_privilege('anon', 'private.student_financial_responsibilities', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'private.student_financial_responsibilities', 'select') as students_cannot_read,
  has_function_privilege('authenticated',
    'public.get_teacher_financial_responsibilities()', 'execute') as teacher_rpc_available,
  has_function_privilege('authenticated',
    'public.set_teacher_financial_responsibility(uuid,uuid,date,text)', 'execute') as assignment_rpc_available,
  has_function_privilege('authenticated',
    'public.end_teacher_financial_responsibility(uuid,date)', 'execute') as termination_rpc_available;
