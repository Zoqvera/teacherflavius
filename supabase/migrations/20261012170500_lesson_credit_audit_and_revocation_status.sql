-- Distinguish historical credit status from effective revocation.
-- No tuition, reservation or credit row is modified by this migration.

create or replace function private.lesson_credit_audit_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with classified as (
    select
      credit.id as credit_id,
      credit.student_id,
      coalesce(nullif(btrim(profile.name), ''), 'Aluno') as student_name,
      credit.reference_month,
      credit.credit_number,
      credit.credit_origin,
      credit.status as original_status,
      case when credit.revoked_at is not null then 'Revogado'
           when credit.status = 'available' then 'Disponível'
           when credit.status = 'scheduled' then 'Agendado'
           when credit.status = 'used' then 'Utilizado'
           else 'Perdido' end as effective_status,
      credit.revoked_at,
      billing.classes_per_month as current_plan_classes,
      (tuition.payment_date is not null or coalesce(tuition.is_exempt, false)) as tuition_settled,
      case
        when credit.revoked_at is not null and booking.status = 'confirmed'
          then 'revoked_confirmed_booking'
        when credit.revoked_at is not null
         and tuition.payment_date is null and not coalesce(tuition.is_exempt, false)
          then 'revoked_unpaid'
        when credit.revoked_at is not null
         and credit.credit_origin = 'contract'
         and billing.classes_per_month is not null
         and credit.credit_number > billing.classes_per_month
          then 'revoked_excess'
        when credit.revoked_at is not null then 'revoked_review'
        when credit.credit_origin = 'contract'
         and tuition.payment_date is null and not coalesce(tuition.is_exempt, false)
          then 'active_unpaid'
        when credit.credit_origin = 'contract'
         and billing.classes_per_month is not null
         and credit.credit_number > billing.classes_per_month
          then 'active_excess'
        else null
      end as classification
    from private.lesson_credits credit
    join public.monthly_tuition tuition on tuition.id = credit.tuition_id
    left join public.student_billing_settings billing on billing.student_id = credit.student_id
    left join public.profiles profile on profile.id = credit.student_id
    left join public.makeup_class_bookings booking on booking.id = credit.makeup_booking_id
  ),
  totals as (
    select
      count(*) filter (where revoked_at is not null)::integer as revoked_total,
      count(*) filter (where classification = 'revoked_unpaid')::integer as revoked_unpaid,
      count(*) filter (where classification = 'revoked_excess')::integer as revoked_excess,
      count(*) filter (where classification = 'revoked_review')::integer as revoked_review,
      count(*) filter (where classification = 'revoked_confirmed_booking')::integer as revoked_confirmed_booking,
      count(*) filter (where classification = 'active_unpaid')::integer as active_unpaid,
      count(*) filter (where classification = 'active_excess')::integer as active_excess
    from classified
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'revoked_total', totals.revoked_total,
      'revoked_unpaid', totals.revoked_unpaid,
      'revoked_excess', totals.revoked_excess,
      'revoked_review', totals.revoked_review,
      'revoked_confirmed_booking', totals.revoked_confirmed_booking,
      'active_unpaid', totals.active_unpaid,
      'active_excess', totals.active_excess
    ),
    'credits', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.reference_month desc, item.credit_number)
      from (
        select
          credit_id, student_name, reference_month, credit_number,
          credit_origin, original_status, effective_status, revoked_at,
          current_plan_classes, tuition_settled, classification
        from classified
        where classification is not null
        order by
          case classification
            when 'revoked_confirmed_booking' then 1
            when 'active_unpaid' then 2
            when 'revoked_review' then 3
            when 'active_excess' then 4
            else 5
          end, reference_month desc, credit_number
        limit 100
      ) item
    ), '[]'::jsonb),
    'details_limit', 100
  )
  from totals;
$function$;

revoke all on function private.lesson_credit_audit_snapshot()
  from public, anon, authenticated;

create or replace function public.get_teacher_lesson_credit_audit()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_teacher_admin() then
    raise exception 'Acesso exclusivo do professor.'
      using errcode = '42501';
  end if;

  return private.lesson_credit_audit_snapshot();
end;
$function$;

revoke all on function public.get_teacher_lesson_credit_audit()
  from public, anon, authenticated;
grant execute on function public.get_teacher_lesson_credit_audit()
  to authenticated, service_role;

-- Extend the existing operational data-quality scanner rather than scheduling
-- a second job. The plan-excess count is a REVIEW signal, not an auto-revocation.
do $migration$
declare
  definition text;
  previous_declaration text := '  metrics_value jsonb;';
  new_declaration text := E'  lesson_credit_audit jsonb;\n  metrics_value jsonb;';
  previous_issues text := E'  select count(*) filter (where severity=\'warning\')::integer,';
  new_issues text := $snippet$
  lesson_credit_audit := private.lesson_credit_audit_snapshot();

  if (lesson_credit_audit #>> '{summary,revoked_confirmed_booking}')::integer > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_revoked_credit_confirmed_booking', 'critical',
      jsonb_build_object('count', (lesson_credit_audit #>> '{summary,revoked_confirmed_booking}')::integer));
  end if;

  if (lesson_credit_audit #>> '{summary,active_unpaid}')::integer > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_active_credit_unpaid_tuition', 'critical',
      jsonb_build_object('count', (lesson_credit_audit #>> '{summary,active_unpaid}')::integer));
  end if;

  if (lesson_credit_audit #>> '{summary,revoked_review}')::integer > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_credit_revocation_requires_review', 'warning',
      jsonb_build_object('count', (lesson_credit_audit #>> '{summary,revoked_review}')::integer));
  end if;

  if (lesson_credit_audit #>> '{summary,active_excess}')::integer > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_legacy_credit_plan_review', 'warning',
      jsonb_build_object('count', (lesson_credit_audit #>> '{summary,active_excess}')::integer));
  end if;

  select count(*) filter (where severity='warning')::integer,
$snippet$;
  previous_metrics text := '  completed_at_value := now();';
  new_metrics text := $snippet$
  metrics_value := metrics_value || jsonb_build_object(
    'lesson_credit_audit', lesson_credit_audit -> 'summary'
  );

  completed_at_value := now();
$snippet$;
begin
  select pg_get_functiondef('private.run_operational_data_quality_check(boolean)'::regprocedure)
    into definition;

  if position(previous_declaration in definition) = 0
     or position(previous_issues in definition) = 0
     or position(previous_metrics in definition) = 0 then
    raise exception 'Unexpected operational data quality scanner definition';
  end if;

  definition := replace(definition, previous_declaration, new_declaration);
  definition := replace(definition, previous_issues, new_issues);
  definition := replace(definition, previous_metrics, new_metrics);
  execute definition;
end;
$migration$;
