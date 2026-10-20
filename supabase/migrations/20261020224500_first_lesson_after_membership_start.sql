-- Assign a first eligible regular class date when a student joins a class.
-- Compare the real start instant in America/Sao_Paulo with the membership timestamp.
-- Existing first-lesson overrides and pre-existing membership records remain intact.
create or replace function private.assign_first_lesson_after_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  scheduled_weekday smallint;
  scheduled_time time without time zone;
  class_first_date date;
  assignment_time timestamptz := coalesce(new.created_at, statement_timestamp());
  candidate_date date;
begin
  select tc.class_weekday, tc.class_start_time, tc.first_lesson_date
  into scheduled_weekday, scheduled_time, class_first_date
  from public.teacher_classes tc
  where tc.class_number = new.class_number;

  if scheduled_weekday is null or scheduled_time is null then
    return new;
  end if;

  candidate_date := (assignment_time at time zone 'America/Sao_Paulo')::date;
  candidate_date := candidate_date
    + ((scheduled_weekday::integer - extract(isodow from candidate_date)::integer + 7) % 7);

  -- A lesson that has already started cannot be the student's first lesson.
  if ((candidate_date + scheduled_time) at time zone 'America/Sao_Paulo')
     <= assignment_time then
    candidate_date := candidate_date + 7;
  end if;

  -- Respect a class-level start date and any later explicit student date.
  if class_first_date is not null and candidate_date < class_first_date then
    candidate_date := class_first_date
      + ((scheduled_weekday::integer - extract(isodow from class_first_date)::integer + 7) % 7);
  end if;

  new.first_lesson_date := greatest(
    coalesce(new.first_lesson_date, candidate_date),
    candidate_date
  );

  return new;
end;
$function$;

revoke all on function private.assign_first_lesson_after_membership()
from public, anon, authenticated;

drop trigger if exists assign_first_lesson_after_membership_trigger
on public.class_students;

create trigger assign_first_lesson_after_membership_trigger
before insert on public.class_students
for each row
execute function private.assign_first_lesson_after_membership();

-- Correct the two memberships added to the Tuesday 09:00 class on Oct 20.
-- Restrict to still-unconfigured, same-day memberships; never rewrite history.
update public.class_students membership
set first_lesson_date = '2026-10-27'::date
from public.teacher_classes class
where class.class_number = membership.class_number
  and class.class_number = 111
  and class.class_weekday = 2
  and class.class_start_time = '09:00:00'::time
  and membership.first_lesson_date is null
  and (membership.created_at at time zone 'America/Sao_Paulo')::date = '2026-10-20'::date
  and membership.created_at >
      (('2026-10-20'::date + class.class_start_time) at time zone 'America/Sao_Paulo');
