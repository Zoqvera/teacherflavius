alter table public.monthly_tuition
  add column if not exists amount_override numeric(10,2);

alter table public.monthly_tuition
  add column if not exists amount_override_reason text;

alter table public.monthly_tuition
  drop constraint if exists monthly_tuition_amount_override_positive;

alter table public.monthly_tuition
  add constraint monthly_tuition_amount_override_positive
  check (amount_override is null or amount_override > 0);

alter table public.monthly_tuition
  drop constraint if exists monthly_tuition_amount_override_reason_length;

alter table public.monthly_tuition
  add constraint monthly_tuition_amount_override_reason_length
  check (
    amount_override_reason is null
    or char_length(amount_override_reason) <= 500
  );

comment on column public.monthly_tuition.amount_override is
  'Valor excepcional da mensalidade para um mes especifico. Quando preenchido, o gerador mensal preserva este valor.';

comment on column public.monthly_tuition.amount_override_reason is
  'Motivo administrativo opcional para o valor excepcional da mensalidade.';

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
    make_date(
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
    ),
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
  where s.active = true
    and s.due_day is not null
    and s.billing_start_month <= normalized_reference_month
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
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
