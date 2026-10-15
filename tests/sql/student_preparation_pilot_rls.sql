\set ON_ERROR_STOP on

-- Standalone synthetic Supabase Auth fixture. No production credentials or data.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Apply the real migration (not a duplicate fixture schema).
\i supabase/migrations/20261015213000_student_preparation_pilot_eligibility.sql

-- Start state: single disabled master switch and no selected students.
do $$
begin
  if (select count(*) from public.student_preparation_pilot_settings) <> 1 then
    raise exception 'Pilot switch must have exactly one disabled row';
  end if;
  if (select enabled from public.student_preparation_pilot_settings where id) is distinct from false then
    raise exception 'Pilot switch must start disabled';
  end if;
  if (select count(*) from public.student_preparation_pilot_members) <> 0 then
    raise exception 'Pilot membership list must begin empty';
  end if;
  if exists (
    select 1 from pg_class
    where oid in (
      'public.student_preparation_pilot_settings'::regclass,
      'public.student_preparation_pilot_members'::regclass
    ) and not relrowsecurity
  ) then
    raise exception 'Pilot tables must have RLS enabled';
  end if;
  if has_table_privilege('anon', 'public.student_preparation_pilot_settings', 'SELECT')
     or has_table_privilege('anon', 'public.student_preparation_pilot_members', 'SELECT') then
    raise exception 'Unauthenticated role can access pilot tables';
  end if;
  if has_table_privilege('authenticated', 'public.student_preparation_pilot_members', 'INSERT')
     or has_table_privilege('authenticated', 'public.student_preparation_pilot_members', 'UPDATE')
     or has_table_privilege('authenticated', 'public.student_preparation_pilot_members', 'DELETE')
     or has_table_privilege('authenticated', 'public.student_preparation_pilot_settings', 'UPDATE') then
    raise exception 'Students can mutate pilot settings or membership';
  end if;
end;
$$;

-- Populate only this disposable database with two synthetic students.
insert into public.student_preparation_pilot_members (user_id, enabled) values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', false);

-- A logged-in student sees the global switch and only their own membership.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  if (select count(*) from public.student_preparation_pilot_settings) <> 1 then
    raise exception 'Authenticated student cannot read the pilot switch';
  end if;
  if (select count(*) from public.student_preparation_pilot_members) <> 1 then
    raise exception 'Student 1 can see other students or lost their own record';
  end if;
  if (select user_id from public.student_preparation_pilot_members)
     <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'Student 1 received another identity';
  end if;
  if (select enabled from public.student_preparation_pilot_members) is distinct from true then
    raise exception 'Student 1 must keep their own pilot flag';
  end if;
end;
$$;

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  if (select count(*) from public.student_preparation_pilot_members) <> 1 then
    raise exception 'Student 2 must see exactly their own membership';
  end if;
  if (select enabled from public.student_preparation_pilot_members) is distinct from false then
    raise exception 'Student 2 must not inherit eligibility from student 1';
  end if;
  if exists (
    select 1 from public.student_preparation_pilot_members
    where user_id = '11111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'Cross-user access bypassed RLS';
  end if;
end;
$$;

-- Missing session cannot see any membership, even with authenticated SQL role.
reset request.jwt.claim.sub;
do $$
begin
  if (select count(*) from public.student_preparation_pilot_members) <> 0 then
    raise exception 'Session-less requests must not see student membership';
  end if;
end;
$$;

reset role;

-- A shutdown is possible without deleting member history.
update public.student_preparation_pilot_settings
set enabled = true
where id;
update public.student_preparation_pilot_settings
set enabled = false
where id;
do $$
begin
  if (select enabled from public.student_preparation_pilot_settings where id) is distinct from false then
    raise exception 'Pilot master switch could not be disabled';
  end if;
  if (select count(*) from public.student_preparation_pilot_members) <> 2 then
    raise exception 'Master switch rollback must not delete pilot memberships';
  end if;
end;
$$;

select 'PASS: isolated pilot migration, RLS isolation, defaults and rollback' as result;
