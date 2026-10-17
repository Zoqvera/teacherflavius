-- Schema-only disaster-recovery overlay, copied verbatim from the reviewed
-- Git migration 20261016162500_justify_attended_cancelled_lesson_revocations.sql.
-- This file is NOT deployed to the live database and contains no customer data.
-- Execute only after overlay 395, as part of a disposable clean-schema build.

-- Documented revocation of a replacement credit after the student attended
-- their originally cancelled class. Historical cancellation and revocation remain.
create table if not exists private.lesson_credit_revocation_justifications (
  credit_id uuid primary key references private.lesson_credits(id) on delete cascade,
  reason_code text not null check (reason_code = 'attended_original_class'),
  reason_detail text not null check (char_length(btrim(reason_detail)) >= 20),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null
);

comment on table private.lesson_credit_revocation_justifications is
  'Teacher-validated reason for retaining a revoked replacement credit after the original cancelled lesson was attended.';
alter table private.lesson_credit_revocation_justifications enable row level security;
revoke all on private.lesson_credit_revocation_justifications from public, anon, authenticated;

create or replace function public.justify_teacher_attended_cancelled_lesson(target_credit_id uuid)
returns jsonb
language plpgsql security definer
set search_path to ''
as $function$
declare
  target_credit private.lesson_credits%rowtype;
  lesson_day date;
begin
  if (select auth.uid()) is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;

  select * into target_credit
  from private.lesson_credits
  where id = target_credit_id
  for update;

  if not found or target_credit.revoked_at is null
     or target_credit.credit_origin <> 'contract'
     or target_credit.regular_starts_at is null
     or target_credit.regular_class_number is null
     or target_credit.cancelled_at is null
     or target_credit.makeup_booking_id is not null then
    raise exception 'Crédito sem requisitos para justificar comparecimento após cancelamento.'
      using errcode = '22023';
  end if;

  lesson_day := (target_credit.regular_starts_at at time zone 'America/Sao_Paulo')::date;

  if not exists (
    select 1 from private.student_regular_lesson_cancellations cancelled
    where cancelled.student_id = target_credit.student_id
      and cancelled.class_number = target_credit.regular_class_number
      and cancelled.lesson_date = lesson_day
  ) or not exists (
    select 1 from public.student_frequency attendance
    where attendance.user_id = target_credit.student_id
      and attendance.class_date = lesson_day
      and attendance.attendance_status = 'Compareceu'
      and attendance.class_notes like ('[Turma ' || target_credit.regular_class_number || ']%')
  ) or not exists (
    select 1 from private.academic_lesson_occurrences occurrence
    where occurrence.student_id = target_credit.student_id
      and occurrence.class_number = target_credit.regular_class_number
      and occurrence.starts_at = target_credit.regular_starts_at
      and occurrence.attendance_status = 'present'
  ) then
    raise exception 'Confirme a presença e preserve o cancelamento antes de justificar.'
      using errcode = '22023';
  end if;

  insert into private.lesson_credit_revocation_justifications
    (credit_id, reason_code, reason_detail, recorded_by)
  values (
    target_credit_id,
    'attended_original_class',
    'Aluno compareceu à aula originalmente cancelada; não há crédito adicional de reposição.',
    (select auth.uid())
  )
  on conflict (credit_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'credit_id', target_credit_id,
    'reason_code', 'attended_original_class'
  );
end;
$function$;

revoke all on function public.justify_teacher_attended_cancelled_lesson(uuid)
  from public, anon, authenticated;
grant execute on function public.justify_teacher_attended_cancelled_lesson(uuid)
  to authenticated;

-- Classify documented revocations as legitimate only while attendance evidence exists.
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
           when credit.status = 'available' then 'Disponível'
           when credit.status = 'scheduled' then 'Agendado'
           when credit.status = 'used' then 'Utilizado'
           else 'Perdido' end as effective_status,
      credit.revoked_at,
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
        else null
      end as classification
    from private.lesson_credits credit
    join public.monthly_tuition tuition on tuition.id = credit.tuition_id
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
      count(*) filter (where classification = 'approved_historical_exception')::integer as approved_historical_exception
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
      'approved_historical_exception', totals.approved_historical_exception
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
            else 5
          end, reference_month desc, credit_number
        limit 100
      ) item
    ), '[]'::jsonb),
    'details_limit', 100
  )
  from totals;
$function$;

-- Prevent tuition resynchronization from reactivating manually justified credits.
CREATE OR REPLACE FUNCTION private.sync_lesson_credits_for_tuition(target_tuition_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  tuition_row public.monthly_tuition%rowtype;
  contracted_count smallint;
  coverage_start date;
  coverage_end date;
begin
  select tuition.*
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id;

  if not found or tuition_row.student_id is null then
    return;
  end if;

  if tuition_row.payment_date is null
     and coalesce(tuition_row.is_exempt, false) = false then
    update public.makeup_class_bookings booking
    set
      status = 'cancelled',
      cancelled_at = coalesce(booking.cancelled_at, now())
    where booking.id in (
      select credit.makeup_booking_id
      from private.lesson_credits credit
      where credit.tuition_id = tuition_row.id
        and credit.credit_origin = 'contract'
        and credit.revoked_at is null
        and credit.makeup_booking_id is not null
    )
      and booking.status = 'confirmed';

    update private.lesson_credits credit
    set revoked_at = coalesce(credit.revoked_at, now())
    where credit.tuition_id = tuition_row.id
      and credit.credit_origin = 'contract'
      and credit.revoked_at is null;

    return;
  end if;

  select settings.classes_per_month
  into contracted_count
  from public.student_billing_settings settings
  where settings.student_id = tuition_row.student_id;

  if contracted_count is null then
    return;
  end if;

  coverage_start := private.get_tuition_coverage_start(tuition_row.id);
  coverage_end := private.get_tuition_coverage_end(tuition_row.id);

  if coverage_start is null then
    coverage_start := tuition_row.due_date;
  end if;

  if coverage_end is null or coverage_end <= coverage_start then
    coverage_end := (coverage_start + interval '1 month')::date;
  end if;

  update public.makeup_class_bookings booking
  set
    status = 'cancelled',
    cancelled_at = coalesce(booking.cancelled_at, now())
  where booking.id in (
    select credit.makeup_booking_id
    from private.lesson_credits credit
    where credit.tuition_id = tuition_row.id
      and credit.credit_origin = 'contract'
      and credit.credit_number > contracted_count
      and not exists (
        select 1 from private.lesson_credit_plan_exceptions approved
        where approved.credit_id = credit.id
      )
      and credit.revoked_at is null
      and credit.makeup_booking_id is not null
  )
    and booking.status = 'confirmed';

  update private.lesson_credits credit
  set revoked_at = case
    when credit.credit_number > contracted_count
      and not exists (
        select 1 from private.lesson_credit_plan_exceptions approved
        where approved.credit_id = credit.id
      )
      then coalesce(credit.revoked_at, now())
    when exists (
      select 1 from private.lesson_credit_revocation_justifications reason
      where reason.credit_id = credit.id
    ) then credit.revoked_at
    else null
  end
  where credit.tuition_id = tuition_row.id
    and credit.credit_origin = 'contract';

  with candidate_occurrences as (
    select
      row_number() over (
        order by
          ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') asc,
          class.class_number asc
      )::smallint as credit_number,
      class.class_number,
      class.class_name,
      ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      (((lesson_day::date + class.class_start_time) + interval '1 hour') at time zone 'America/Sao_Paulo') as ends_at
    from public.class_students membership
    join public.teacher_classes class
      on class.class_number = membership.class_number
     and class.is_active = true
    cross join generate_series(
      coverage_start::timestamp,
      (coverage_end - 1)::timestamp,
      interval '1 day'
    ) as lesson_day
    where membership.user_id = tuition_row.student_id
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
      and (
        membership.first_lesson_date is null
        or lesson_day::date >= membership.first_lesson_date
      )
  ),
  desired_credits as (
    select
      series.credit_number::smallint as credit_number,
      occurrence.class_number,
      occurrence.class_name,
      occurrence.starts_at,
      occurrence.ends_at
    from generate_series(1, contracted_count::integer) as series(credit_number)
    left join candidate_occurrences occurrence
      on occurrence.credit_number = series.credit_number
  )
  insert into private.lesson_credits (
    student_id,
    tuition_id,
    reference_month,
    credit_number,
    status,
    credit_origin,
    regular_class_number,
    regular_class_name,
    regular_starts_at,
    regular_ends_at,
    revoked_at
  )
  select
    tuition_row.student_id,
    tuition_row.id,
    tuition_row.reference_month,
    desired.credit_number,
    case when desired.starts_at is null then 'available' else 'scheduled' end,
    'contract',
    desired.class_number,
    desired.class_name,
    desired.starts_at,
    desired.ends_at,
    null
  from desired_credits desired
  on conflict (tuition_id, credit_number) do update
  set
    revoked_at = case
      when exists (
        select 1 from private.lesson_credit_revocation_justifications reason
        where reason.credit_id = private.lesson_credits.id
      ) then private.lesson_credits.revoked_at
      else null
    end,
    status = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.status
      else private.lesson_credits.status
    end,
    regular_class_number = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_class_number
      else private.lesson_credits.regular_class_number
    end,
    regular_class_name = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_class_name
      else private.lesson_credits.regular_class_name
    end,
    regular_starts_at = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_starts_at
      else private.lesson_credits.regular_starts_at
    end,
    regular_ends_at = case
      when private.lesson_credits.credit_origin = 'contract'
       and private.lesson_credits.cancelled_at is null
       and private.lesson_credits.makeup_booking_id is null
       and private.lesson_credits.status in ('scheduled', 'available')
        then excluded.regular_ends_at
      else private.lesson_credits.regular_ends_at
    end;
end;
$function$;
