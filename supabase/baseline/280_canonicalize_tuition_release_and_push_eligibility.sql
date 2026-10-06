-- Canonical tuition availability for student-facing billing.
create or replace function private.get_tuition_student_availability(
  target_tuition_id uuid
)
returns table (
  available_on date,
  effective_due_date date
)
language sql
stable
security definer
set search_path = ''
as $function$
  with target as (
    select
      tuition.student_id,
      tuition.reference_month,
      tuition.due_date,
      tuition.created_at,
      settings.billing_start_month
    from public.monthly_tuition tuition
    left join public.student_billing_settings settings
      on settings.student_id = tuition.student_id
    where tuition.id = target_tuition_id
  ),
  timing as (
    select
      target.*,
      case
        when target.billing_start_month is not null
          and target.reference_month = target.billing_start_month
        then timezone('America/Sao_Paulo', target.created_at)::date
        else (
          select previous_tuition.payment_date + 2
          from public.monthly_tuition previous_tuition
          where previous_tuition.student_id = target.student_id
            and previous_tuition.reference_month = (
              date_trunc('month', target.reference_month::timestamp)
              - interval '1 month'
            )::date
            and previous_tuition.payment_date is not null
          limit 1
        )
      end as available_on
    from target
  )
  select
    timing.available_on,
    case
      when timing.available_on is null then null
      else greatest(timing.due_date, timing.available_on)
    end as effective_due_date
  from timing;
$function$;

revoke all on function private.get_tuition_student_availability(uuid)
  from public, anon, authenticated;

create or replace function public.get_my_pending_tuitions()
returns table (
  tuition_id uuid,
  reference_month date,
  due_date date,
  amount_due numeric,
  payment_status text,
  attempt_id uuid,
  provider_payment_id text,
  attempt_status text,
  attempt_status_detail text
)
language plpgsql
security definer
set search_path = ''
stable
as $function$
declare
  current_user_id uuid := auth.uid();
  local_today date := timezone('America/Sao_Paulo', now())::date;
begin
  if current_user_id is null then
    raise exception 'É necessário entrar na conta para consultar mensalidades.';
  end if;

  return query
  select
    tuition.id,
    tuition.reference_month,
    availability.effective_due_date,
    tuition.amount_due,
    case
      when availability.effective_due_date < local_today then 'overdue'
      when availability.effective_due_date = local_today then 'due_today'
      when availability.effective_due_date = local_today + 1 then 'due_tomorrow'
      when availability.effective_due_date = local_today + 2 then 'due_in_two_days'
      when availability.effective_due_date <= local_today + 7 then 'due_soon'
      else 'open'
    end::text,
    latest_attempt.id,
    latest_attempt.provider_payment_id,
    latest_attempt.status,
    latest_attempt.status_detail
  from public.monthly_tuition tuition
  cross join lateral private.get_tuition_student_availability(tuition.id) availability
  left join lateral (
    select
      attempt.id,
      attempt.provider_payment_id,
      attempt.status,
      attempt.status_detail
    from public.tuition_payment_attempts attempt
    where attempt.tuition_id = tuition.id
      and attempt.student_id = current_user_id
    order by attempt.created_at desc
    limit 1
  ) latest_attempt on true
  where tuition.student_id = current_user_id
    and tuition.payment_date is null
    and not tuition.is_exempt
    and availability.available_on is not null
    and availability.available_on <= local_today
  order by availability.effective_due_date asc, tuition.reference_month asc;
end;
$function$;

revoke all on function public.get_my_pending_tuitions() from public, anon;
grant execute on function public.get_my_pending_tuitions()
  to authenticated, service_role;
