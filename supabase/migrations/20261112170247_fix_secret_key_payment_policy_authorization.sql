-- Fix server-only payment policy RPC authorization for modern sb_secret API keys.
-- PostgREST resolves these keys to PostgreSQL role service_role, without the
-- legacy request.jwt.claim.role setting. Retain existing function EXECUTE ACLs.
do $migration$
declare
  target_function regprocedure;
  function_definition text;
  old_guard constant text := 'current_setting(''request.jwt.claim.role'', true) is distinct from ''service_role''';
  new_guard constant text := 'current_setting(''role'', true) is distinct from ''service_role''';
  updated_functions integer := 0;
begin
  for target_function in
    select procedure.oid::regprocedure
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'get_enrollment_checkout_policy_context',
        'get_enrollment_subscription_policy_context'
      )
  loop
    function_definition := pg_catalog.pg_get_functiondef(target_function);
    if pg_catalog.strpos(function_definition, old_guard) = 0 then
      raise exception 'Unexpected authorization guard in %', target_function;
    end if;
    execute pg_catalog.replace(function_definition, old_guard, new_guard);
    updated_functions := updated_functions + 1;
  end loop;

  if updated_functions <> 2 then
    raise exception 'Expected to update 2 functions, updated %', updated_functions;
  end if;
end;
$migration$;

-- Keep RPC execution service-only, including for future API exposures.
revoke all on function public.get_enrollment_checkout_policy_context(uuid[])
  from public, anon, authenticated;
revoke all on function public.get_enrollment_subscription_policy_context(uuid)
  from public, anon, authenticated;
grant execute on function public.get_enrollment_checkout_policy_context(uuid[]) to service_role;
grant execute on function public.get_enrollment_subscription_policy_context(uuid) to service_role;
