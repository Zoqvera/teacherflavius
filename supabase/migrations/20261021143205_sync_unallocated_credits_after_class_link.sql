-- A student's tuition may be settled before they are assigned to a regular class.
-- In that order, the tuition trigger creates unallocated contractual credits.
-- Allocate those credits only after the new class membership is visible.
-- Never reschedule previously assigned, cancelled, used, or revoked credits.
create or replace function private.sync_unallocated_credits_after_class_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settled_tuition record;
begin
  if new.user_id is null then
    return new;
  end if;

  for settled_tuition in
    select tuition.id
    from public.monthly_tuition tuition
    join public.student_billing_settings settings
      on settings.student_id = tuition.student_id
     and settings.active = true
     and settings.classes_per_month > 0
    where tuition.student_id = new.user_id
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false))
      and private.get_tuition_coverage_end(tuition.id)
        > (now() at time zone 'America/Sao_Paulo')::date
      -- No existing assigned or historically modified contractual credit
      -- may be touched by this enrollment-only reconciliation.
      and not exists (
        select 1
        from private.lesson_credits credit
        where credit.tuition_id = tuition.id
          and credit.credit_origin = 'contract'
          and (
            credit.status is distinct from 'available'
            or credit.regular_class_number is not null
            or credit.regular_starts_at is not null
            or credit.regular_ends_at is not null
            or credit.cancelled_at is not null
            or credit.makeup_booking_id is not null
            or credit.revoked_at is not null
          )
      )
    order by tuition.due_date, tuition.id
  loop
    perform private.sync_lesson_credits_for_tuition(settled_tuition.id);
  end loop;

  return new;
end;
$function$;

revoke all on function private.sync_unallocated_credits_after_class_link()
  from public, anon, authenticated;

drop trigger if exists sync_unallocated_credits_after_class_link
  on public.class_students;

create trigger sync_unallocated_credits_after_class_link
  after insert or update of class_number, user_id
  on public.class_students
  for each row
  when (new.user_id is not null)
  execute function private.sync_unallocated_credits_after_class_link();
