-- Stage 1D.3: isolated/disaster-recovery schema ONLY. NEVER deploy as a production migration.
-- The historical baseline defines 85 restrictive policies although production
-- has zero restrictive policies. Later reviewed overlays already replace four;
-- the remaining 81 are normalized here to match production's mode.
--
-- Security conditions: explicit role allowlist including deny-all payment exception, exactly 81
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

  if restrictive_count <> 85 then
    raise exception 'Unexpected count of restrictive policies: %; expected 85', restrictive_count;
  end if;

  -- Exactly four obsolete restrictive policies do not exist in production.
  -- Fail closed if any name, operation, role or mode has drifted.
  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and permissive = 'RESTRICTIVE'
      and roles = array['authenticated']::name[]
      and (
        (tablename = 'study_roadmap_completion'
          and policyname = 'Alunos podem atualizar suas lições do roteiro'
          and cmd = 'UPDATE')
        or (tablename = 'study_roadmap_completion'
          and policyname = 'Alunos podem inserir suas lições do roteiro'
          and cmd = 'INSERT')
        or (tablename = 'teacher_admins'
          and policyname = 'Professor pode verificar suas próprias credenciais'
          and cmd = 'SELECT')
        or (tablename = 'teacher_exercises'
          and policyname = 'Alunos e professores podem visualizar exercícios'
          and cmd = 'SELECT')
      )
  ) <> 4 then
    raise exception 'Obsolete restrictive policy allowlist does not match';
  end if;

  -- These four named policies are absent from the production catalog.
  -- Dropping them is only permitted during isolated recovery.
  drop policy "Alunos podem atualizar suas lições do roteiro"
    on public.study_roadmap_completion;
  drop policy "Alunos podem inserir suas lições do roteiro"
    on public.study_roadmap_completion;
  drop policy "Professor pode verificar suas próprias credenciais"
    on public.teacher_admins;
  drop policy "Alunos e professores podem visualizar exercícios"
    on public.teacher_exercises;

  select count(*) into restrictive_count
  from pg_catalog.pg_policies
  where schemaname in ('public', 'private') and permissive = 'RESTRICTIVE';
  if restrictive_count <> 81 then
    raise exception 'Expected 81 remaining restrictive policies, found %', restrictive_count;
  end if;

  -- One deny-all payment policy intentionally applies to both browser roles.
  -- Its predicates must remain FALSE; any other multi-role policy is rejected.
  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'tuition_payment_attempts'
      and policyname = 'tuition_payment_attempts_no_direct_client_access'
      and permissive = 'RESTRICTIVE'
      and cmd = 'ALL'
      and roles = array['anon','authenticated']::name[]
      and qual = 'false'
      and with_check = 'false'
  ) <> 1 then
    raise exception 'Payment deny-all policy no longer matches the reviewed source';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where permissive = 'RESTRICTIVE'
      and (
        schemaname <> 'public'
        or (
          roles <> array['authenticated']::name[]
          and not (
            tablename = 'tuition_payment_attempts'
            and policyname = 'tuition_payment_attempts_no_direct_client_access'
            and roles = array['anon','authenticated']::name[]
          )
        )
      )
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
      'create policy %I on %I.%I as permissive for %s to %s',
      policy_row.policyname, policy_row.schemaname,
      policy_row.tablename, policy_row.cmd,
      case
        when policy_row.roles = array['anon','authenticated']::name[]
          then 'anon, authenticated'
        else 'authenticated'
      end
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
