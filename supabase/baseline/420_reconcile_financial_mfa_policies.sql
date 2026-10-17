-- ETAPA 1D.4: DISPOSABLE CANONICAL BOOTSTRAP ONLY.
-- Never apply this overlay as a production migration or run on live data.
-- Production already requires public.is_teacher_admin_mfa() on these 3 policies.
-- The reviewed historical snapshot uses is_teacher_admin() without MFA.
-- Preserve policy names, operations, roles, RLS mode and every other policy.
do $canonical_financial_mfa$
declare
  baseline_signature jsonb;
  updated_signature jsonb;
  expected_count integer;
begin
  if to_regprocedure('public.is_teacher_admin_mfa()') is null then
    raise exception 'Teacher MFA authorization function is missing';
  end if;

  if exists (
    select 1
    from (values
      ('monthly_tuition', 'Administradores gerenciam mensalidades', 'ALL'),
      ('monthly_tuition_events', 'Administradores visualizam eventos financeiros', 'SELECT'),
      ('student_billing_settings', 'Administradores gerenciam configurações financeiras', 'ALL')
    ) as expected(tablename, policyname, cmd)
    left join pg_catalog.pg_policies pol
      on pol.schemaname = 'public'
      and pol.tablename = expected.tablename
      and pol.policyname = expected.policyname
    left join pg_catalog.pg_class target_table
      on target_table.oid = to_regclass('public.' || expected.tablename)
    where pol.policyname is null
      or pol.cmd <> expected.cmd
      or pol.permissive <> 'PERMISSIVE'
      or pol.roles <> array['authenticated']::name[]
      or pol.qual <> 'is_teacher_admin()'
      or (
        expected.cmd = 'ALL' and
        pol.with_check is distinct from 'is_teacher_admin()'
      )
      or (
        expected.cmd = 'SELECT' and pol.with_check is not null
      )
      or not coalesce(target_table.relrowsecurity, false)
  ) then
    raise exception 'Financial RLS baseline does not match reviewed preconditions';
  end if;

  select count(*) into expected_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in (
      'monthly_tuition', 'monthly_tuition_events', 'student_billing_settings'
    );
  if expected_count <> 3 then
    raise exception 'Unexpected extra financial policies in the bootstrap';
  end if;

  select jsonb_object_agg(
    schemaname || '.' || tablename || '.' || policyname,
    jsonb_build_object(
      'cmd', cmd,
      'mode', permissive,
      'roles', roles,
      'qual', qual,
      'check', with_check
    )
  ) into baseline_signature
  from pg_catalog.pg_policies
  where schemaname in ('public', 'private')
    and tablename not in (
      'monthly_tuition', 'monthly_tuition_events', 'student_billing_settings'
    );

  alter policy "Administradores gerenciam mensalidades"
    on public.monthly_tuition
    using (public.is_teacher_admin_mfa())
    with check (public.is_teacher_admin_mfa());

  alter policy "Administradores visualizam eventos financeiros"
    on public.monthly_tuition_events
    using (public.is_teacher_admin_mfa());

  alter policy "Administradores gerenciam configurações financeiras"
    on public.student_billing_settings
    using (public.is_teacher_admin_mfa())
    with check (public.is_teacher_admin_mfa());

  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and (
        (
          tablename = 'monthly_tuition'
          and policyname = 'Administradores gerenciam mensalidades'
          and cmd = 'ALL'
          and with_check = 'is_teacher_admin_mfa()'
        ) or (
          tablename = 'monthly_tuition_events'
          and policyname = 'Administradores visualizam eventos financeiros'
          and cmd = 'SELECT'
          and with_check is null
        ) or (
          tablename = 'student_billing_settings'
          and policyname = 'Administradores gerenciam configurações financeiras'
          and cmd = 'ALL'
          and with_check = 'is_teacher_admin_mfa()'
        )
      )
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and qual = 'is_teacher_admin_mfa()'
  ) <> 3 then
    raise exception 'Financial RLS MFA predicates did not match production';
  end if;

  select jsonb_object_agg(
    schemaname || '.' || tablename || '.' || policyname,
    jsonb_build_object(
      'cmd', cmd,
      'mode', permissive,
      'roles', roles,
      'qual', qual,
      'check', with_check
    )
  ) into updated_signature
  from pg_catalog.pg_policies
  where schemaname in ('public', 'private')
    and tablename not in (
      'monthly_tuition', 'monthly_tuition_events', 'student_billing_settings'
    );

  if baseline_signature is distinct from updated_signature then
    raise exception 'An unrelated RLS policy changed during financial alignment';
  end if;
end;
$canonical_financial_mfa$;
