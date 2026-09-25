-- Tier teacher/admin authorization by operational risk.
-- Routine professor workflows use authenticated teacher/admin access (AAL1).
-- Sensitive financial, privacy, deletion, and system-health operations keep MFA/AAL2.

do $$
declare
  policy_record record;
  next_qual text;
  next_with_check text;
  alter_statement text;
begin
  for policy_record in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ilike '%is_teacher_admin_mfa%'
        or coalesce(with_check, '') ilike '%is_teacher_admin_mfa%'
      )
      and tablename <> all (array[
        'monthly_tuition',
        'monthly_tuition_events',
        'student_billing_settings',
        'data_retention_policies',
        'data_retention_runs',
        'data_subject_requests'
      ])
  loop
    next_qual := policy_record.qual;
    next_with_check := policy_record.with_check;

    if next_qual is not null then
      next_qual := replace(next_qual, 'public.is_teacher_admin_mfa()', 'public.is_teacher_admin()');
      next_qual := replace(next_qual, 'is_teacher_admin_mfa()', 'is_teacher_admin()');
    end if;

    if next_with_check is not null then
      next_with_check := replace(next_with_check, 'public.is_teacher_admin_mfa()', 'public.is_teacher_admin()');
      next_with_check := replace(next_with_check, 'is_teacher_admin_mfa()', 'is_teacher_admin()');
    end if;

    alter_statement := format(
      'alter policy %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );

    if next_qual is not null then
      alter_statement := alter_statement || ' using (' || next_qual || ')';
    end if;

    if next_with_check is not null then
      alter_statement := alter_statement || ' with check (' || next_with_check || ')';
    end if;

    execute alter_statement;
  end loop;
end;
$$;

do $$
declare
  function_record record;
  next_definition text;
begin
  for function_record in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%is_teacher_admin_mfa%'
      and p.proname <> all (array[
        'is_teacher_admin_mfa',
        'generate_monthly_tuition',
        'get_teacher_billing_students',
        'get_teacher_monthly_tuition',
        'get_teacher_payment_operations_dashboard',
        'get_teacher_student_tuition_history',
        'mark_tuition_exempt',
        'record_tuition_payment',
        'reverse_tuition_exemption',
        'reverse_tuition_payment',
        'save_student_billing_settings',
        'close_student_account_for_privacy',
        'complete_account_deletion_request',
        'complete_account_deletion_request__mfa_inner',
        'complete_data_subject_request',
        'delete_teacher_student',
        'get_data_retention_dashboard',
        'get_external_data_processor_dashboard',
        'mark_account_deletion_in_review',
        'mark_data_subject_request_in_review',
        'review_external_data_processor',
        'run_data_retention_maintenance_now'
      ])
  loop
    next_definition := replace(
      function_record.definition,
      'public.is_teacher_admin_mfa()',
      'public.is_teacher_admin()'
    );
    next_definition := replace(
      next_definition,
      'is_teacher_admin_mfa()',
      'public.is_teacher_admin()'
    );
    next_definition := replace(
      next_definition,
      'Autenticação administrativa em duas etapas obrigatória.',
      'Acesso administrativo do professor obrigatório.'
    );
    next_definition := replace(
      next_definition,
      'MFA do professor é obrigatório.',
      'Acesso administrativo do professor obrigatório.'
    );

    execute next_definition;
  end loop;
end;
$$;

comment on function public.is_teacher_admin_mfa()
is 'Step-up authorization for sensitive professor/admin operations. Routine professor workflows use is_teacher_admin(); financial, privacy, deletion and other high-risk flows continue to require AAL2.';
