-- Backfill only the first billing cycle for active students whose configured
-- billing starts in the current or a future month and whose tuition row is
-- still missing. This makes the immediate-payment rule effective for existing
-- recent enrollments without creating historical overdue rows.

with local_clock as (
  select date_trunc('month', timezone('America/Sao_Paulo', now()))::date as current_month
),
eligible_first_cycles as (
  select
    s.student_id,
    s.billing_start_month as reference_month,
    make_date(
      extract(year from s.billing_start_month)::integer,
      extract(month from s.billing_start_month)::integer,
      least(
        s.due_day::integer,
        extract(
          day from (
            date_trunc('month', s.billing_start_month)
            + interval '1 month - 1 day'
          )
        )::integer
      )
    ) as due_date,
    round(s.monthly_fee, 2) as amount_due
  from public.student_billing_settings s
  join public.profiles p on p.id = s.student_id
  cross join local_clock
  where s.active = true
    and s.due_day is not null
    and s.monthly_fee > 0
    and s.billing_start_month >= local_clock.current_month
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
)
insert into public.monthly_tuition (
  student_id,
  subject_ref,
  reference_month,
  due_date,
  amount_due,
  created_by,
  updated_by
)
select
  cycle.student_id,
  cycle.student_id,
  cycle.reference_month,
  cycle.due_date,
  cycle.amount_due,
  null,
  null
from eligible_first_cycles cycle
where not exists (
  select 1
  from public.monthly_tuition mt
  where mt.student_id = cycle.student_id
    and mt.reference_month = cycle.reference_month
)
on conflict (student_id, reference_month) do nothing;
