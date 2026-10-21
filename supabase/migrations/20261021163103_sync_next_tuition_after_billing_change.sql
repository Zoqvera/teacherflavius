-- Recheck the next tuition when a billing plan is enabled or edited after payment.
-- Only one next cycle is eligible; never change paid/exempt records or duplicate
-- a due date/reference month already present for the same student.
create or replace function private.ensure_next_tuition_after_billing_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_reference_month date :=
    date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
  last_paid_reference_month date;
  last_paid_subject_ref uuid;
  next_reference_month date;
  next_due_date date;
  enrolled_on date;
  first_due_date date;
begin
  if new.active is not true
     or new.due_day is null
     or new.monthly_fee <= 0 then
    return new;
  end if;

  select
    coalesce(
      timezone('America/Sao_Paulo', profile.enrolled_at)::date,
      timezone('America/Sao_Paulo', profile.created_at)::date
    ),
    profile.tuition_first_due_date
  into enrolled_on, first_due_date
  from public.profiles as profile
  where profile.id = new.student_id
    and profile.enrolled is true
    and profile.archived is false;

  if not found then
    return new;
  end if;

  -- Respect paused courses and permanent billing exemptions.
  if exists (
    select 1
    from public.student_course_states as course
    where course.student_id = new.student_id
      and (
        course.course_status = 'paused'
        or course.billing_exemption = 'permanent'
      )
  ) then
    return new;
  end if;

  -- Prevent old payments from generating historical charges on plan changes.
  select tuition.reference_month, tuition.subject_ref
  into last_paid_reference_month, last_paid_subject_ref
  from public.monthly_tuition as tuition
  where tuition.student_id = new.student_id
    and tuition.payment_date is not null
    and tuition.is_exempt is false
    and tuition.reference_month >=
      (current_reference_month - interval '1 month')::date
  order by tuition.reference_month desc
  limit 1;

  if not found then
    return new;
  end if;

  next_reference_month :=
    (last_paid_reference_month + interval '1 month')::date;

  if next_reference_month < current_reference_month
     or next_reference_month < new.billing_start_month then
    return new;
  end if;

  next_due_date := make_date(
    extract(year from next_reference_month)::integer,
    extract(month from next_reference_month)::integer,
    least(
      new.due_day::integer,
      extract(day from (
        date_trunc('month', next_reference_month)
        + interval '1 month - 1 day'
      ))::integer
    )
  );

  if next_reference_month = new.billing_start_month
     and first_due_date is not null then
    next_due_date := first_due_date;
  end if;

  if next_due_date < enrolled_on then
    return new;
  end if;

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
    new.student_id,
    coalesce(last_paid_subject_ref, new.student_id),
    next_reference_month,
    next_due_date,
    round(new.monthly_fee, 2),
    null,
    null
  where not exists (
    select 1
    from public.monthly_tuition as existing
    where existing.student_id = new.student_id
      and (
        existing.reference_month = next_reference_month
        or existing.due_date = next_due_date
      )
  )
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function private.ensure_next_tuition_after_billing_change()
  from public, anon, authenticated;

drop trigger if exists ensure_next_tuition_after_billing_change
  on public.student_billing_settings;

create trigger ensure_next_tuition_after_billing_change
after insert or update of active, monthly_fee, due_day, billing_start_month
on public.student_billing_settings
for each row
when (new.active is true)
execute function private.ensure_next_tuition_after_billing_change();
