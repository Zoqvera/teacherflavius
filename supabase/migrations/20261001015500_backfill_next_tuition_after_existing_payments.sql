-- Seed exactly one next tuition cycle for active students whose latest paid
-- tuition predates the automatic next-cycle trigger. The payment page still
-- unlocks a future cycle only after the prior payment is at least two days old.

with latest_paid as (
  select distinct on (mt.student_id)
    mt.student_id,
    mt.subject_ref,
    mt.reference_month,
    mt.payment_date
  from public.monthly_tuition mt
  join public.student_billing_settings settings
    on settings.student_id = mt.student_id
  join public.profiles profile
    on profile.id = mt.student_id
  where mt.payment_date is not null
    and settings.active = true
    and settings.due_day is not null
    and settings.monthly_fee > 0
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false
  order by mt.student_id, mt.reference_month desc
),
next_cycles as (
  select
    latest.student_id,
    coalesce(latest.subject_ref, latest.student_id) as subject_ref,
    (
      date_trunc('month', latest.reference_month::timestamp)
      + interval '1 month'
    )::date as reference_month,
    settings.due_day,
    round(settings.monthly_fee, 2) as amount_due
  from latest_paid latest
  join public.student_billing_settings settings
    on settings.student_id = latest.student_id
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
  cycle.subject_ref,
  cycle.reference_month,
  make_date(
    extract(year from cycle.reference_month)::integer,
    extract(month from cycle.reference_month)::integer,
    least(
      cycle.due_day::integer,
      extract(
        day from (
          date_trunc('month', cycle.reference_month)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  ),
  cycle.amount_due,
  null,
  null
from next_cycles cycle
where not exists (
  select 1
  from public.monthly_tuition existing
  where existing.student_id = cycle.student_id
    and existing.reference_month = cycle.reference_month
)
on conflict (student_id, reference_month) do nothing;
