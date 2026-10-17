-- Stage 1D.3: isolated/disaster-recovery schema ONLY. NEVER deploy as a production migration.
-- The historical baseline defines 85 restrictive policies although production
-- has zero restrictive policies. Later reviewed overlays already replace four;
-- the remaining 81 are normalized here to match production's mode.
--
-- Security conditions: explicit allowlist of one authenticated role, exactly 81
-- restrictive PUBLIC-schema policies, and exact conservation of every command,
-- role and RLS predicate. No user rows or secrets are read or written.
do $canonical_permissive_policy_repair$
declare
  policy_row record;
  declaration text;
  before_signature jsonb;
  after_signature jsonb;
  restrictive_count integer;
  remaining_count integer;
begin
  select count(*) into restrictive_count
  from pg_catalog.pg_policies
  where schemaname in ('public', 'private') and permissive = 'RESTRICTIVE';

  if restrictive_count <> 81 then
    raise exception 'Unexpected count of restrictive policies: %; expected 81', restrictive_count;
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where permissive = 'RESTRICTIVE'
      and (schemaname <> 'public' or roles <> array['authenticated']::name[])
  ) then
    raise exception 'Found restrictive policies outside the reviewed role/schema';
  end if;

  select jsonb_object_agg(
    schemaname || '.' || tablename || '.' || policyname,
    jsonb_build_object(
      'cmd', cmd,
      'roles', roles,
      'qual', qual,
      'with_check', with_check
    )
  ) into before_signature
  from pg_catalog.pg_policies
  where schemaname in ('public', 'private') and permissive = 'RESTRICTIVE';

  for policy_row in
    select * from pg_catalog.pg_policies
    where schemaname='public' and permissive='RESTRICTIVE'
    order by tablename, policyname
  loop
    -- Re-create the exact currently compiled policy; change mode only.
    declaration := format(
      'create policy %I on %I.%I as permissive for %s to authenticated',
      policy_row.policyname, policy_row.schemaname,
      policy_row.tablename, policy_row.cmd
    );
    if policy_row.qual is not null then
      declaration := declaration || ' using (' || policy_row.qual || ')';
    end if;
    if policy_row.with_check is not null then
      declaration := declaration || ' with check (' || policy_row.with_check || ')';
    end if;

    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
    execute declaration;
  end loop;

  select count(*) into remaining_count
  from pg_catalog.pg_policies
  where schemaname in ('public', 'private') and permissive = 'RESTRICTIVE';
  if remaining_count <> 0 then
    raise exception 'Unexpected restrictive policies remain';
  end if;

  select jsonb_object_agg(
    schemaname || '.' || tablename || '.' || policyname,
    jsonb_build_object(
      'cmd', cmd,
      'roles', roles,
      'qual', qual,
      'with_check', with_check
    )
  ) into after_signature
  from pg_catalog.pg_policies
  where schemaname in ('public', 'private')
    and before_signature ? (schemaname || '.' || tablename || '.' || policyname);

  if before_signature is distinct from after_signature then
    raise exception 'Policy predicate, command or role changed during mode alignment';
  end if;
end;
$canonical_permissive_policy_repair$;
