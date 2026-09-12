do $$
declare
  function_oid oid;
  function_ddl text;
begin
  select p.oid
    into strict function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'close_student_account_for_privacy'
    and pg_get_function_identity_arguments(p.oid) = 'target_user_id uuid';

  function_ddl := pg_get_functiondef(function_oid);

  if function_ddl not ilike '%is_teacher_admin_mfa(%' then
    if position('if not coalesce(public.is_teacher_admin(), false) then' in function_ddl) = 0 then
      raise exception 'Unexpected close_student_account_for_privacy authorization contract.';
    end if;

    function_ddl := replace(
      function_ddl,
      'if not coalesce(public.is_teacher_admin(), false) then',
      'if not public.is_teacher_admin_mfa() then'
    );
    execute function_ddl;
  end if;
end;
$$;

do $$
declare
  function_oid oid;
  function_ddl text;
begin
  select p.oid
    into strict function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'complete_account_deletion_request__mfa_inner'
    and pg_get_function_identity_arguments(p.oid) = 'p_request_id uuid, p_resolution_note text';

  function_ddl := pg_get_functiondef(function_oid);

  if function_ddl not ilike '%is_teacher_admin_mfa(%' then
    if position('if not coalesce(public.is_teacher_admin(), false) then' in function_ddl) = 0 then
      raise exception 'Unexpected complete_account_deletion_request__mfa_inner authorization contract.';
    end if;

    function_ddl := replace(
      function_ddl,
      'if not coalesce(public.is_teacher_admin(), false) then',
      'if not public.is_teacher_admin_mfa() then'
    );
    execute function_ddl;
  end if;
end;
$$;

revoke all on function public.close_student_account_for_privacy(uuid) from public, anon, authenticated;
grant execute on function public.close_student_account_for_privacy(uuid) to service_role;

revoke all on function public.complete_account_deletion_request__mfa_inner(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_account_deletion_request__mfa_inner(uuid, text) to service_role;
