-- Recovery overlay for early access to the next tuition after payment.
-- This mirrors migration 20261001015000.

create or replace function public.prepare_next_tuition_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  settings_row public.student_billing_settings%rowtype;
  next_reference_month date;
  next_due_date date;
begin
  if new.payment_date is null or new.student_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.payment_date is not distinct from new.payment_date then
    return new;
  end if;

  select settings.*
  into settings_row
  from public.student_billing_settings settings
  join public.profiles profile on profile.id = settings.student_id
  where settings.student_id = new.student_id
    and settings.active = true
    and settings.due_day is not null
    and settings.monthly_fee > 0
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false;

  if not found then
    return new;
  end if;

  next_reference_month := (
    date_trunc('month', new.reference_month::timestamp)
    + interval '1 month'
  )::date;

  if next_reference_month < settings_row.billing_start_month then
    return new;
  end if;

  next_due_date := make_date(
    extract(year from next_reference_month)::integer,
    extract(month from next_reference_month)::integer,
    least(
      settings_row.due_day::integer,
      extract(
        day from (
          date_trunc('month', next_reference_month)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  );

  insert into public.monthly_tuition (
    student_id,
    subject_ref,
    reference_month,
    due_date,
    amount_due,
    created_by,
    updated_by
  ) values (
    new.student_id,
    coalesce(new.subject_ref, new.student_id),
    next_reference_month,
    next_due_date,
    round(settings_row.monthly_fee, 2),
    null,
    null
  )
  on conflict (student_id, reference_month) do update
  set
    due_date = excluded.due_date,
    amount_due = coalesce(
      public.monthly_tuition.amount_override,
      excluded.amount_due
    ),
    updated_at = now(),
    updated_by = null
  where public.monthly_tuition.payment_date is null
    and not public.monthly_tuition.is_exempt
    and (
      public.monthly_tuition.due_date is distinct from excluded.due_date
      or (
        public.monthly_tuition.amount_override is null
        and public.monthly_tuition.amount_due is distinct from excluded.amount_due
      )
    );

  return new;
end;
$function$;

revoke all on function public.prepare_next_tuition_after_payment()
  from public, anon, authenticated;

drop trigger if exists monthly_tuition_prepare_next_after_payment
  on public.monthly_tuition;

create trigger monthly_tuition_prepare_next_after_payment
after insert or update of payment_date on public.monthly_tuition
for each row
when (new.payment_date is not null)
execute function public.prepare_next_tuition_after_payment();

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
set search_path = public, pg_temp
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
      or exists (
        select 1
        from public.monthly_tuition previous_tuition
        where previous_tuition.student_id = current_user_id
          and previous_tuition.reference_month = (
            date_trunc('month', mt.reference_month::timestamp)
            - interval '1 month'
          )::date
          and previous_tuition.payment_date is not null
          and previous_tuition.payment_date <= local_today - 2
      )
    )
  order by mt.due_date asc, mt.reference_month asc;
end;
$function$;

revoke all on function public.get_my_pending_tuitions() from public, anon;
grant execute on function public.get_my_pending_tuitions() to authenticated, service_role;
