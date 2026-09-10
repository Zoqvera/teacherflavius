-- Require verified TOTP MFA (AAL2) for teacher/admin privileged access.
-- Student self-service paths remain governed by auth.uid() and are not promoted to AAL2.

create or replace function public.is_teacher_admin_mfa()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select case
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then true
    else coalesce(public.is_teacher_admin(), false)
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  end;
$$;

revoke all on function public.is_teacher_admin_mfa() from public, anon;
grant execute on function public.is_teacher_admin_mfa() to authenticated, service_role;

comment on function public.is_teacher_admin_mfa()
is 'Returns true for a teacher/admin session only after MFA raises the JWT assurance level to aal2; service_role remains trusted.';

-- Replace only the teacher/admin branch of mixed RLS policies. Student-owned
-- access remains intact because auth.uid() predicates are preserved verbatim.
do $$
declare
  policy_record record;
  new_qual text;
  new_with_check text;
  alter_statement text;
begin
  for policy_record in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ilike '%is_teacher_admin%'
        or coalesce(with_check, '') ilike '%is_teacher_admin%'
      )
  loop
    new_qual := case
      when policy_record.qual is null then null
      else replace(
        replace(policy_record.qual, 'public.is_teacher_admin()', 'public.is_teacher_admin_mfa()'),
        'is_teacher_admin()',
        'public.is_teacher_admin_mfa()'
      )
    end;

    new_with_check := case
      when policy_record.with_check is null then null
      else replace(
        replace(policy_record.with_check, 'public.is_teacher_admin()', 'public.is_teacher_admin_mfa()'),
        'is_teacher_admin()',
        'public.is_teacher_admin_mfa()'
      )
    end;

    alter_statement := format(
      'alter policy %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );

    if new_qual is not null then
      alter_statement := alter_statement || ' using (' || new_qual || ')';
    end if;

    if new_with_check is not null then
      alter_statement := alter_statement || ' with check (' || new_with_check || ')';
    end if;

    execute alter_statement;
  end loop;
end;
$$;

-- Keep the public API function names stable while moving the pre-existing
-- implementations behind AAL2 wrappers. This avoids copying large function
-- bodies and makes the authorization boundary explicit at the database edge.
do $$
declare
  function_record record;
  inner_name text;
  call_arguments text;
  function_body text;
  create_statement text;
begin
  for function_record in
    select
      p.oid,
      p.proname,
      p.pronargs,
      p.proargtypes,
      p.proretset,
      pg_get_function_identity_arguments(p.oid) as identity_args,
      pg_get_function_arguments(p.oid) as function_args,
      pg_get_function_result(p.oid) as function_result,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.prorettype <> 'trigger'::regtype
      and p.prorettype <> 'event_trigger'::regtype
      and p.proname not like '%__mfa_inner'
      and p.proname not in (
        'is_teacher_admin',
        'is_teacher_admin_mfa',
        'create_data_subject_request',
        'request_account_deletion',
        'ensure_weekly_plan_snapshot',
        'set_my_weekly_task_completed',
        'log_student_page_access'
      )
      and (
        pg_get_functiondef(p.oid) ilike '%public.is_teacher_admin(%'
        or pg_get_functiondef(p.oid) ilike '%teacher_admins%'
        or p.proname = 'save_student_billing_settings'
      )
    order by p.proname, pg_get_function_identity_arguments(p.oid)
  loop
    inner_name := function_record.proname || '__mfa_inner';

    if exists (
      select 1
      from pg_proc inner_function
      join pg_namespace inner_namespace
        on inner_namespace.oid = inner_function.pronamespace
      where inner_namespace.nspname = 'public'
        and inner_function.proname = inner_name
        and inner_function.proargtypes = function_record.proargtypes
    ) then
      raise exception 'MFA inner function already exists for %.%(%)',
        'public', function_record.proname, function_record.identity_args;
    end if;

    execute format(
      'alter function public.%I(%s) rename to %I',
      function_record.proname,
      function_record.identity_args,
      inner_name
    );

    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      inner_name,
      function_record.identity_args
    );
    execute format(
      'grant execute on function public.%I(%s) to service_role',
      inner_name,
      function_record.identity_args
    );

    select string_agg('$' || argument_number::text, ', ' order by argument_number)
      into call_arguments
    from generate_series(1, function_record.pronargs) as argument_number;
    call_arguments := coalesce(call_arguments, '');

    if function_record.proretset then
      function_body := format(
        E'begin\n  if not public.is_teacher_admin_mfa() then\n    raise exception ''Autenticação administrativa em duas etapas obrigatória.'' using errcode = ''42501'';\n  end if;\n  return query select * from public.%I(%s);\nend;',
        inner_name,
        call_arguments
      );
    elsif function_record.function_result = 'void' then
      function_body := format(
        E'begin\n  if not public.is_teacher_admin_mfa() then\n    raise exception ''Autenticação administrativa em duas etapas obrigatória.'' using errcode = ''42501'';\n  end if;\n  perform public.%I(%s);\n  return;\nend;',
        inner_name,
        call_arguments
      );
    else
      function_body := format(
        E'begin\n  if not public.is_teacher_admin_mfa() then\n    raise exception ''Autenticação administrativa em duas etapas obrigatória.'' using errcode = ''42501'';\n  end if;\n  return public.%I(%s);\nend;',
        inner_name,
        call_arguments
      );
    end if;

    create_statement := format(
      'create function public.%I(%s) returns %s language plpgsql security definer set search_path = public, auth, pg_temp as %L',
      function_record.proname,
      function_record.function_args,
      function_record.function_result,
      function_body
    );
    execute create_statement;

    execute format(
      'revoke all on function public.%I(%s) from public, anon',
      function_record.proname,
      function_record.identity_args
    );
    execute format(
      'grant execute on function public.%I(%s) to authenticated, service_role',
      function_record.proname,
      function_record.identity_args
    );
  end loop;
end;
$$;
