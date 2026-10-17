-- ETAPA 1D.4: disposable PostgreSQL only. Catalog security assertions.
do $verify_financial_mfa$
declare
  policy_row record;
  validated integer := 0;
begin
  if to_regprocedure('public.is_teacher_admin_mfa()') is null then
    raise exception 'Teacher MFA predicate helper missing';
  end if;

  for policy_row in
    select * from pg_catalog.pg_policies
    where schemaname='public'
      and tablename in (
        'monthly_tuition',
        'monthly_tuition_events',
        'student_billing_settings'
      )
  loop
    if policy_row.permissive <> 'PERMISSIVE'
      or policy_row.roles <> array['authenticated']::name[]
      or policy_row.qual <> 'is_teacher_admin_mfa()'
      or (
        policy_row.tablename = 'monthly_tuition'
        and (
          policy_row.policyname <> 'Administradores gerenciam mensalidades'
          or policy_row.cmd <> 'ALL'
          or policy_row.with_check <> 'is_teacher_admin_mfa()'
        )
      )
      or (
        policy_row.tablename = 'monthly_tuition_events'
        and (
          policy_row.policyname <> 'Administradores visualizam eventos financeiros'
          or policy_row.cmd <> 'SELECT'
          or policy_row.with_check is not null
        )
      )
      or (
        policy_row.tablename = 'student_billing_settings'
        and (
          policy_row.policyname <> 'Administradores gerenciam configurações financeiras'
          or policy_row.cmd <> 'ALL'
          or policy_row.with_check <> 'is_teacher_admin_mfa()'
        )
      )
    then
      raise exception 'Unsafe or unexpected financial policy on %', policy_row.tablename;
    end if;
    validated := validated + 1;
  end loop;

  if validated <> 3 then
    raise exception 'Expected three reviewed financial policies, got %', validated;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public'
      and c.relname in (
        'monthly_tuition', 'monthly_tuition_events','student_billing_settings'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'Public finance table missing RLS';
  end if;

  if (select count(*) from pg_catalog.pg_policies
      where schemaname='public' and tablename='study_lesson_pages'
        and (coalesce(qual,'') like '%is_teacher_admin_mfa%'
           or coalesce(with_check,'') like '%is_teacher_admin_mfa%')
     ) <> 4 then
    raise exception 'Lesson page MFA predicates were unintentionally modified';
  end if;
end;
$verify_financial_mfa$;
