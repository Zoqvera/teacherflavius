-- Recovery overlay: allow first tuition on enrollment day and preserve its explicit first due date.

create or replace function public.reject_open_tuition_before_enrollment()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  enrollment_date date;
begin
  if new.student_id is null
     or new.payment_date is not null
     or coalesce(new.is_exempt, false) then
    return new;
  end if;

  select coalesce(
    timezone('America/Sao_Paulo', p.enrolled_at)::date,
    timezone('America/Sao_Paulo', p.created_at)::date
  )
  into enrollment_date
  from public.profiles p
  where p.id = new.student_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if enrollment_date is not null
     and new.due_date < enrollment_date then
    raise exception
      'O vencimento da mensalidade não pode ser anterior à data de matrícula.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.reject_open_tuition_before_enrollment()
  from public, anon, authenticated;

create or replace function public.generate_monthly_tuition__mfa_inner(
  target_reference_month date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  normalized_reference_month date;
  affected_count integer := 0;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  normalized_reference_month := date_trunc(
    'month',
    coalesce(target_reference_month, current_date)
  )::date;

  insert into public.monthly_tuition (
    student_id,
    reference_month,
    due_date,
    amount_due,
    created_by,
    updated_by
  )
  select
    s.student_id,
    generated_month.reference_month::date,
    effective_due.due_date,
    s.monthly_fee,
    auth.uid(),
    auth.uid()
  from public.student_billing_settings s
  join public.profiles p on p.id = s.student_id
  cross join lateral generate_series(
    s.billing_start_month::timestamp,
    normalized_reference_month::timestamp,
    interval '1 month'
  ) as generated_month(reference_month)
  cross join lateral (
    select make_date(
      extract(year from generated_month.reference_month)::integer,
      extract(month from generated_month.reference_month)::integer,
      least(
        s.due_day::integer,
        extract(
          day from (
            date_trunc('month', generated_month.reference_month)
            + interval '1 month - 1 day'
          )
        )::integer
      )
    ) as recurring_due_date
  ) calculated_due
  cross join lateral (
    select case
      when generated_month.reference_month::date = s.billing_start_month
       and p.tuition_first_due_date is not null
        then p.tuition_first_due_date
      else calculated_due.recurring_due_date
    end::date as due_date
  ) effective_due
  where s.active = true
    and s.due_day is not null
    and s.billing_start_month <= normalized_reference_month
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and effective_due.due_date >= coalesce(
      timezone('America/Sao_Paulo', p.enrolled_at)::date,
      timezone('America/Sao_Paulo', p.created_at)::date
    )
  on conflict (student_id, reference_month) do update
  set
    due_date = excluded.due_date,
    amount_due = coalesce(
      public.monthly_tuition.amount_override,
      excluded.amount_due
    ),
    updated_at = now(),
    updated_by = auth.uid()
  where public.monthly_tuition.payment_date is null
    and not public.monthly_tuition.is_exempt
    and (
      public.monthly_tuition.due_date is distinct from excluded.due_date
      or (
        public.monthly_tuition.amount_override is null
        and public.monthly_tuition.amount_due is distinct from excluded.amount_due
      )
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$function$;
