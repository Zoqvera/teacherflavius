-- Administrative enrollments intentionally have technical, blocked Auth accounts.
-- Their missing confirmation/identity and contact-email mismatch are expected.
-- Only exempt an account if ALL administrative safety invariants hold.
create or replace function private.is_expected_blocked_admin_identity(
  target_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = target_user_id
      and p.access_mode = 'administrative'
      and u.raw_app_meta_data -> 'administrative_student' = 'true'::jsonb
      and private.is_banned_administrative_identity(u.id)
  );
$function$;

revoke all on function private.is_expected_blocked_admin_identity(uuid)
  from public, anon, authenticated;
grant execute on function private.is_expected_blocked_admin_identity(uuid)
  to service_role;

-- Preserve the entire current monitor, including the earlier fix that
-- only flags missing profiles after enrollment authorization. Replace the
-- three narrowly scoped predicates and fail closed if its shape changes.
do $migration$
declare
  existing_definition text;
  updated_definition text;
  expected_clauses text[] := array[
    '    and u.confirmed_at is null;',
    '    and not exists (select 1 from auth.identities i where i.user_id = u.id);',
    '    and l.google_user_id is null;'
  ];
  replacement_clauses text[] := array[
    E'    and u.confirmed_at is null\n    and not private.is_expected_blocked_admin_identity(p.id);',
    E'    and not exists (select 1 from auth.identities i where i.user_id = u.id)\n    and not private.is_expected_blocked_admin_identity(p.id);',
    E'    and l.google_user_id is null\n    and not private.is_expected_blocked_admin_identity(p.id);'
  ];
  index_value integer;
begin
  select pg_get_functiondef(
    'private.run_auth_account_health_check(boolean)'::regprocedure
  ) into existing_definition;

  if existing_definition is null then
    raise exception 'Auth health monitor is missing';
  end if;

  updated_definition := existing_definition;

  for index_value in 1..array_length(expected_clauses, 1) loop
    if strpos(updated_definition, expected_clauses[index_value]) = 0 then
      raise exception 'Auth health monitor predicate % has changed', index_value;
    end if;

    updated_definition := replace(
      updated_definition,
      expected_clauses[index_value],
      replacement_clauses[index_value]
    );
  end loop;

  execute updated_definition;
end;
$migration$;

-- Retain the original privileged monitor's access restrictions.
revoke all on function private.run_auth_account_health_check(boolean)
  from public, anon, authenticated;
grant execute on function private.run_auth_account_health_check(boolean)
  to service_role;
