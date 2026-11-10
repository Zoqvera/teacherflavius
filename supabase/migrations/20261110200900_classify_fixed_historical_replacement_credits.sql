-- Read-only audit extension: historical FIXO/INDIVIDUAL credits can retain valid
-- replacement rights after their tuition coverage ends. Assess the actual RPC
-- eligibility and financial criteria instead of expiring or revoking records.
-- No changes to booking functions, student credit ledger, or historical rights.
CREATE OR REPLACE FUNCTION private.lesson_credit_audit_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
           when credit.status = 'available' and flexible.enabled = true and coverage.ends_at <= today.local_date and credit.revoked_at is null then 'Vencido'
           when credit.status = 'available' and flexible.enabled = true
                and coverage.begins_at > today.local_date then 'Ainda não vigente'
           when credit.status = 'available' and flexible.enabled = true
                and credit.credit_origin = 'contract'
                and tuition.payment_date is null
                and not coalesce(tuition.is_exempt, false) then 'Pagamento pendente'
           when credit.status = 'available' and flexible.enabled = true
                and (credit.cancelled_at is not null
                     or credit.regular_starts_at is not null
                     or credit.makeup_booking_id is not null) then 'Não elegível'

           when fixed_eligibility.is_historical_credit
                and fixed_eligibility.can_book_replacement then 'Reposição preservada'
           when fixed_eligibility.is_historical_credit then 'Sem reposição'
           when credit.status = 'available' then 'Disponível'
           when credit.status = 'scheduled' then 'Agendado'
           when credit.status = 'used' then 'Utilizado'
           else 'Perdido' end as effective_status,
      credit.revoked_at,
      (credit.status = 'available' and flexible.enabled = true and coverage.ends_at <= today.local_date and credit.revoked_at is null) as expired_flexible_available,
      (credit.status = 'available'
        and credit.revoked_at is null
        and flexible.enabled = true
        and credit.cancelled_at is null
        and credit.regular_starts_at is null
        and credit.makeup_booking_id is null
        and credit.credit_origin in ('contract', 'manual_grant')
        and (credit.credit_origin = 'manual_grant'
             or tuition.payment_date is not null
             or coalesce(tuition.is_exempt, false))
        and coverage.begins_at <= today.local_date
        and today.local_date < coverage.ends_at) as flexible_usable_today,
      fixed_eligibility.is_historical_credit
        and fixed_eligibility.can_book_replacement as fixed_historical_replacement_eligible,
      fixed_eligibility.is_historical_credit
        and not fixed_eligibility.can_book_replacement as fixed_historical_without_replacement,
      fixed_eligibility.can_book_replacement as fixed_replacement_usable,
      approved.approval_reason,
      justified.reason_detail as revocation_justification,
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
        when credit.revoked_at is not null
         and justified.reason_code = 'attended_original_class'
         and credit.regular_starts_at is not null
         and credit.cancelled_at is not null
         and exists (
           select 1 from private.student_regular_lesson_cancellations cancellation
           where cancellation.student_id = credit.student_id
             and cancellation.class_number = credit.regular_class_number
             and cancellation.lesson_date = (credit.regular_starts_at at time zone 'America/Sao_Paulo')::date
         )
         and exists (
           select 1 from public.student_frequency attendance
           where attendance.user_id = credit.student_id
             and attendance.class_date = (credit.regular_starts_at at time zone 'America/Sao_Paulo')::date
             and attendance.attendance_status = 'Compareceu'
             and attendance.class_notes like ('[Turma ' || credit.regular_class_number || ']%')
         )
         and exists (
           select 1 from private.academic_lesson_occurrences occurrence
           where occurrence.student_id = credit.student_id
             and occurrence.class_number = credit.regular_class_number
             and occurrence.starts_at = credit.regular_starts_at
             and occurrence.attendance_status = 'present'
         )
          then 'revoked_attended_original_class'
        when credit.revoked_at is not null then 'revoked_review'
        when credit.credit_origin = 'contract'
         and tuition.payment_date is null and not coalesce(tuition.is_exempt, false)
          then 'active_unpaid'
        when credit.credit_origin = 'contract'
         and billing.classes_per_month is not null
         and credit.credit_number > billing.classes_per_month
         and approved.credit_id is not null
          then 'approved_historical_exception'
        when credit.credit_origin = 'contract'
         and billing.classes_per_month is not null
         and credit.credit_number > billing.classes_per_month
          then 'active_excess'
        when credit.status = 'available' and flexible.enabled = true and coverage.ends_at <= today.local_date and credit.revoked_at is null
          then 'expired_flexible_available'
        when fixed_eligibility.is_historical_credit
             and fixed_eligibility.can_book_replacement
          then 'fixed_historical_replacement_eligible'
        when fixed_eligibility.is_historical_credit
          then 'fixed_historical_without_replacement'
        else null
      end as classification
    from private.lesson_credits credit
    join public.monthly_tuition tuition on tuition.id = credit.tuition_id
    cross join lateral (select (now() at time zone 'America/Sao_Paulo')::date as local_date) today
    cross join lateral (
      select private.get_tuition_coverage_start(tuition.id) as begins_at,
             private.get_tuition_coverage_end(tuition.id) as ends_at
    ) coverage
    left join private.flexible_students flexible
      on flexible.student_id = credit.student_id and flexible.enabled = true
    cross join lateral (
      select
        (
          credit.status = 'available'
          and credit.revoked_at is null
          and coalesce(flexible.enabled, false) = false
          and coverage.ends_at <= today.local_date
        ) as is_historical_credit,
        case
          when credit.status = 'available'
               and credit.revoked_at is null
               and coalesce(flexible.enabled, false) = false
          then private.is_student_replacement_credit_eligible(
            credit.student_id,
            credit.credit_origin,
            credit.cancelled_at,
            credit.regular_starts_at
          ) and (
            credit.credit_origin = 'manual_grant'
            or tuition.payment_date is not null
            or coalesce(tuition.is_exempt, false)
          )
          else false
        end as can_book_replacement
    ) fixed_eligibility
    left join public.student_billing_settings billing on billing.student_id = credit.student_id
    left join public.profiles profile on profile.id = credit.student_id
    left join public.makeup_class_bookings booking on booking.id = credit.makeup_booking_id
    left join private.lesson_credit_plan_exceptions approved on approved.credit_id = credit.id
    left join private.lesson_credit_revocation_justifications justified on justified.credit_id = credit.id
  ),
  totals as (
    select
      count(*) filter (where revoked_at is not null)::integer as revoked_total,
      count(*) filter (where classification = 'revoked_unpaid')::integer as revoked_unpaid,
      count(*) filter (where classification = 'revoked_excess')::integer as revoked_excess,
      count(*) filter (where classification = 'revoked_review')::integer as revoked_review,
      count(*) filter (where classification = 'revoked_attended_original_class')::integer as revoked_attended_original_class,
      count(*) filter (where classification = 'revoked_confirmed_booking')::integer as revoked_confirmed_booking,
      count(*) filter (where classification = 'active_unpaid')::integer as active_unpaid,
      count(*) filter (where classification = 'active_excess')::integer as active_excess,
      count(*) filter (where classification = 'approved_historical_exception')::integer as approved_historical_exception,
      count(*) filter (where expired_flexible_available)::integer as expired_flexible_available,
      count(*) filter (where flexible_usable_today)::integer as flexible_usable_today,
      count(*) filter (where fixed_historical_replacement_eligible)::integer as fixed_historical_replacement_eligible,
      count(*) filter (where fixed_historical_without_replacement)::integer as fixed_historical_without_replacement,
      count(*) filter (where fixed_replacement_usable)::integer as fixed_replacement_usable
    from classified
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'revoked_total', totals.revoked_total,
      'revoked_unpaid', totals.revoked_unpaid,
      'revoked_excess', totals.revoked_excess,
      'revoked_review', totals.revoked_review,
      'revoked_attended_original_class', totals.revoked_attended_original_class,
      'revoked_confirmed_booking', totals.revoked_confirmed_booking,
      'active_unpaid', totals.active_unpaid,
      'active_excess', totals.active_excess,
      'approved_historical_exception', totals.approved_historical_exception,
      'expired_flexible_available', totals.expired_flexible_available,
      'flexible_usable_today', totals.flexible_usable_today,
      'fixed_historical_replacement_eligible', totals.fixed_historical_replacement_eligible,
      'fixed_historical_without_replacement', totals.fixed_historical_without_replacement,
      'fixed_replacement_usable', totals.fixed_replacement_usable
    ),
    'credits', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.reference_month desc, item.credit_number)
      from (
        select
          credit_id, student_name, reference_month, credit_number,
          credit_origin, original_status, effective_status, revoked_at,
          current_plan_classes, tuition_settled, classification, approval_reason,
          revocation_justification
        from classified
        where classification is not null
        order by
          case classification
            when 'revoked_confirmed_booking' then 1
            when 'active_unpaid' then 2
            when 'revoked_review' then 3
            when 'active_excess' then 4
            when 'expired_flexible_available' then 5
            when 'fixed_historical_without_replacement' then 6
            when 'fixed_historical_replacement_eligible' then 7
            else 5
          end, reference_month desc, credit_number
        limit 100
      ) item
    ), '[]'::jsonb),
    'details_limit', 100
  )
  from totals;
$function$;
