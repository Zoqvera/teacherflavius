-- Allow the server-side administrative endpoint to work with the private weekly plan.
-- No client role receives any access.
grant usage on schema private to service_role;
grant select, insert, update, delete on private.administrative_weekly_plans to service_role;

-- Archiving suspends recurring weekly billing and removes future unpaid invoices.
-- Unarchiving resumes from the next Tuesday, without recreating paused periods.
create or replace function private.sync_administrative_weekly_archive_state()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  today_local date := (now() at time zone 'America/Sao_Paulo')::date;
  next_tuesday date;
begin
  if new.archived is not distinct from old.archived then
    return new;
  end if;
  if not exists (
    select 1 from private.administrative_weekly_plans wp
    where wp.student_id=new.id
  ) then
    return new;
  end if;
  if new.archived is true then
    update private.administrative_weekly_plans
    set active=false,updated_at=now()
    where student_id=new.id;
    delete from public.administrative_weekly_tuition
    where student_id=new.id
      and due_date>=today_local
      and payment_date is null;
  else
    next_tuesday := today_local
      + ((2 - extract(isodow from today_local)::integer + 7) % 7);
    update private.administrative_weekly_plans
    set active=true,
      first_due_date=greatest(first_due_date,next_tuesday),
      updated_at=now()
    where student_id=new.id;
    perform private.generate_administrative_weekly_tuition(today_local);
  end if;
  return new;
end;
$function$;
revoke all on function private.sync_administrative_weekly_archive_state()
  from public,anon,authenticated;
drop trigger if exists sync_administrative_weekly_archive_state on public.profiles;
create trigger sync_administrative_weekly_archive_state
after update of archived on public.profiles
for each row execute function private.sync_administrative_weekly_archive_state();
