-- Inert until a separately reviewed Auth hook issues this role to an
-- explicitly approved OAuth client. Do not enable the hook in this migration.
begin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'teacher_payment_agent') then
    raise exception 'Role teacher_payment_agent already exists; review its privileges first';
  end if;
end;
$$;

create role teacher_payment_agent nologin noinherit nobypassrls;
grant teacher_payment_agent to authenticator;
grant usage on schema public to teacher_payment_agent;
grant execute on function public.is_teacher_admin() to teacher_payment_agent;
grant execute on function public.record_tuition_payment(uuid, date, numeric, text, text)
  to teacher_payment_agent;

-- Refuse deployment if inherited PUBLIC privileges make the role broader
-- than expected. Trigger functions cannot be called as ordinary RPCs.
do $$
begin
  if pg_has_role('teacher_payment_agent', 'authenticated', 'member')
    or pg_has_role('teacher_payment_agent', 'anon', 'member') then
    raise exception 'Payment agent must not inherit ordinary application roles';
  end if;

  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege('teacher_payment_agent', c.oid, 'SELECT')
        or has_table_privilege('teacher_payment_agent', c.oid, 'INSERT')
        or has_table_privilege('teacher_payment_agent', c.oid, 'UPDATE')
        or has_table_privilege('teacher_payment_agent', c.oid, 'DELETE'))
  ) then
    raise exception 'Payment agent has unexpected table privileges';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype <> 'pg_catalog.trigger'::regtype
      and has_function_privilege('teacher_payment_agent', p.oid, 'EXECUTE')
      and p.oid not in (
        'public.is_teacher_admin()'::regprocedure,
        'public.record_tuition_payment(uuid,date,numeric,text,text)'::regprocedure
      )
  ) then
    raise exception 'Payment agent has unexpected public function privileges';
  end if;
end;
$$;

commit;
