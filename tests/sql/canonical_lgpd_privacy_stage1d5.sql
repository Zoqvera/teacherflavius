-- Stage 1D.5: exercise LGPD RLS and read-only grants in disposable PostgreSQL.
-- This test creates only synthetic records inside a rolled-back transaction.
begin;

do $lgpd_catalog_integrity$
declare
  policy_count integer;
  relation_name text;
begin
  foreach relation_name in array array[
    'data_subject_requests', 'data_retention_policies', 'data_retention_runs'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = relation_name
        and c.relrowsecurity
    ) then
      raise exception 'RLS missing on LGPD relation %', relation_name;
    end if;
    if has_table_privilege('anon', format('public.%I', relation_name), 'SELECT')
       or not has_table_privilege(
         'authenticated', format('public.%I', relation_name), 'SELECT'
       )
       or has_table_privilege(
         'authenticated', format('public.%I', relation_name), 'INSERT'
       )
       or has_table_privilege(
         'authenticated', format('public.%I', relation_name), 'UPDATE'
       )
       or has_table_privilege(
         'authenticated', format('public.%I', relation_name), 'DELETE'
       )
       or not has_table_privilege(
         'service_role', format('public.%I', relation_name), 'SELECT'
       )
    then
      raise exception 'LGPD relation % has unsafe or missing ACLs', relation_name;
    end if;
  end loop;

  select count(*) into policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in (
      'data_subject_requests', 'data_retention_policies', 'data_retention_runs'
    );
  if policy_count <> 4 then
    raise exception 'Expected exactly four LGPD policies, found %', policy_count;
  end if;

  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'data_subject_requests', 'data_retention_policies', 'data_retention_runs'
      )
      and policyname in (
        'teacher_reads_privacy_requests',
        'teacher_reads_data_retention_policies',
        'teacher_reads_data_retention_runs'
      )
      and cmd = 'SELECT' and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and qual ilike '%is_teacher_admin_mfa()%'
      and with_check is null
  ) <> 3 then
    raise exception 'LGPD teacher read policies must retain reviewed admin gate';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'data_subject_requests'
      and policyname = 'subjects_read_own_privacy_requests'
      and cmd = 'SELECT' and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and qual like '%auth.uid()%'
      and qual like '%subject_user_id%'
      and with_check is null
  ) then
    raise exception 'LGPD owner read policy differs from reviewed source';
  end if;

  if (
    select count(*) from pg_catalog.pg_constraint c
    where c.conrelid in (
      'public.data_subject_requests'::regclass,
      'public.data_retention_policies'::regclass,
      'public.data_retention_runs'::regclass
    )
  ) <> 11 then
    raise exception 'Incomplete LGPD table constraints';
  end if;

  if (
    select count(*) from pg_catalog.pg_index i
    where i.indrelid in (
      'public.data_subject_requests'::regclass,
      'public.data_retention_policies'::regclass,
      'public.data_retention_runs'::regclass
    )
  ) <> 7 then
    raise exception 'Incomplete LGPD table indexes';
  end if;
end;
$lgpd_catalog_integrity$;

insert into public.data_subject_requests (
  id, subject_user_id, request_type, request_details
)
values
  (
    '33196c89-ea80-483b-9c9c-b517b0e4f120',
    '0c39cd1b-b518-43eb-8f9d-e5eb68acc4a2',
    'data_access',
    'Synthetic own request'
  ),
  (
    '319cffcf-8622-4666-8768-82e1411b63b4',
    '4f74df0a-d785-4cb8-a1b7-a360cfb6c5b2',
    'data_access',
    'Synthetic other request'
  );

insert into public.data_retention_policies (
  dataset, category, rationale
)
values ('stage1d5_test', 'test', 'Synthetic policy; rolled back');

insert into public.data_retention_runs (trigger_source, status)
values ('manual', 'completed');

select set_config(
  'request.jwt.claim.sub', '0c39cd1b-b518-43eb-8f9d-e5eb68acc4a2', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

set local role authenticated;

do $lgpd_student_behavior$
begin
  if (select count(*) from public.data_subject_requests) <> 1 then
    raise exception 'A student must read their own request only';
  end if;

  if exists (
    select 1 from public.data_subject_requests
    where subject_user_id <> auth.uid()
  ) then
    raise exception 'Student read another data subject request';
  end if;

  if (select count(*) from public.data_retention_policies) <> 0
     or (select count(*) from public.data_retention_runs) <> 0 then
    raise exception 'A non-teacher accessed the retention catalog';
  end if;
end;
$lgpd_student_behavior$;

reset role;
rollback;
