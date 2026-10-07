create temporary table tuition_due_date_dedup_targets
on commit drop
as
with duplicate_groups as (
  select
    tuition.student_id,
    tuition.due_date,
    count(*) as row_count
  from public.monthly_tuition tuition
  where tuition.due_date is not null
  group by tuition.student_id, tuition.due_date
  having count(distinct tuition.reference_month) > 1
),
ranked_duplicates as (
  select
    tuition.id as tuition_id,
    tuition.student_id,
    tuition.reference_month,
    tuition.due_date as old_due_date,
    profile.tuition_due_day,
    coalesce(
      timezone('America/Sao_Paulo', profile.enrolled_at)::date,
      profile.tuition_due_day_anchor_date,
      timezone('America/Sao_Paulo', profile.created_at)::date
    ) as enrollment_date,
    row_number() over (
      partition by tuition.student_id, tuition.due_date
      order by tuition.reference_month asc, tuition.id
    ) as duplicate_rank,
    count(*) over (
      partition by tuition.student_id, tuition.due_date
    ) as duplicate_count,
    min(tuition.reference_month) over (
      partition by tuition.student_id
    ) as first_student_reference_month
  from public.monthly_tuition tuition
  join duplicate_groups duplicate
    on duplicate.student_id = tuition.student_id
   and duplicate.due_date = tuition.due_date
  join public.profiles profile
    on profile.id = tuition.student_id
),
repairable as (
  select
    duplicate.*,
    make_date(
      extract(year from duplicate.reference_month)::integer,
      extract(month from duplicate.reference_month)::integer,
      least(
        duplicate.tuition_due_day::integer,
        extract(
          day from (
            date_trunc('month', duplicate.reference_month)
            + interval '1 month - 1 day'
          )
        )::integer
      )
    ) as recurring_due_date
  from ranked_duplicates duplicate
  where duplicate.duplicate_rank < duplicate.duplicate_count
)
select
  repairable.tuition_id,
  repairable.student_id,
  repairable.reference_month,
  repairable.old_due_date,
  case
    when repairable.recurring_due_date between repairable.enrollment_date
      and repairable.enrollment_date + 1
      then repairable.recurring_due_date
    else repairable.enrollment_date
  end::date as new_due_date
from repairable;

do $validation$
begin
  if exists (
    select 1
    from tuition_due_date_dedup_targets target
    where target.reference_month <> (
      select min(other.reference_month)
      from public.monthly_tuition other
      where other.student_id = target.student_id
    )
  ) then
    raise exception
      'Duplicate tuition due-date repair stopped: a collision does not involve the student''s first competence.';
  end if;

  if exists (
    select 1
    from tuition_due_date_dedup_targets target
    join public.monthly_tuition other
      on other.student_id = target.student_id
     and other.id <> target.tuition_id
     and other.due_date = target.new_due_date
  ) then
    raise exception
      'Duplicate tuition due-date repair stopped: a proposed corrected date already exists.';
  end if;
end;
$validation$;

insert into public.monthly_tuition_events (
  tuition_id,
  action,
  actor_id,
  details
)
select
  target.tuition_id,
  'due_date_corrected_after_enrollment',
  null,
  jsonb_build_object(
    'source', 'duplicate_due_date_integrity_repair',
    'reference_month', target.reference_month,
    'previous_due_date', target.old_due_date,
    'corrected_due_date', target.new_due_date
  )
from tuition_due_date_dedup_targets target
where target.old_due_date is distinct from target.new_due_date;

update public.monthly_tuition tuition
set
  due_date = target.new_due_date,
  updated_at = now()
from tuition_due_date_dedup_targets target
where tuition.id = target.tuition_id
  and tuition.due_date is distinct from target.new_due_date;

update public.profiles profile
set
  tuition_first_due_date = target.new_due_date
from tuition_due_date_dedup_targets target
join public.student_billing_settings settings
  on settings.student_id = target.student_id
 and settings.billing_start_month = target.reference_month
where profile.id = target.student_id
  and profile.tuition_first_due_date is null;

alter table public.monthly_tuition
  add constraint monthly_tuition_student_id_due_date_key
  unique (student_id, due_date);
