-- Make the student's first configured tuition payable immediately after the
-- teacher defines the monthly fee, even when the first due date falls in the
-- following calendar month. Later future months remain hidden until their month.
-- Financial date comparisons use America/Sao_Paulo consistently.

create or replace function public.get_my_pending_tuitions()
returns table(
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
stable
security definer
set search_path = public, pg_temp
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
    mt.id,
    mt.reference_month,
    mt.due_date,
    mt.amount_due,
    case
      when mt.due_date < local_today then 'overdue'
      when mt.due_date = local_today then 'due_today'
      when mt.due_date = local_today + 1 then 'due_tomorrow'
      when mt.due_date = local_today + 2 then 'due_in_two_days'
      when mt.due_date <= local_today + 7 then 'due_soon'
      else 'open'
    end::text,
    latest_attempt.id,
    latest_attempt.provider_payment_id,
    latest_attempt.status,
    latest_attempt.status_detail
  from public.monthly_tuition mt
  left join public.student_billing_settings settings
    on settings.student_id = current_user_id
  left join lateral (
    select
      attempt.id,
      attempt.provider_payment_id,
      attempt.status,
      attempt.status_detail
    from public.tuition_payment_attempts attempt
    where attempt.tuition_id = mt.id
      and attempt.student_id = current_user_id
    order by attempt.created_at desc
    limit 1
  ) latest_attempt on true
  where mt.student_id = current_user_id
    and mt.payment_date is null
    and not mt.is_exempt
    and (
      mt.reference_month <= date_trunc('month', local_today)::date
      or mt.reference_month = settings.billing_start_month
    )
  order by mt.due_date asc, mt.reference_month asc;
end;
$function$;

revoke all on function public.get_my_pending_tuitions() from public, anon;
grant execute on function public.get_my_pending_tuitions() to authenticated, service_role;
