-- Retire the 15-minute class-seat hold and automatic enrollment workflow.
-- Preserve historical rows, ordinary enrollments, promotional-price holds and billing.
-- Keep public.get_public_class_seat_availability() as a read-only dependency of the academic secretary.

-- Fail closed even for previously cached pages and privileged server-side callers.
create function private.reject_disabled_class_seat_reservation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'A reserva de turmas foi desativada. Solicite um convite de matrícula ao professor.'
    using errcode = '42501';
end;
$$;

create trigger reject_disabled_class_seat_hold
before insert on private.class_seat_holds
for each row execute function private.reject_disabled_class_seat_reservation();

create trigger reject_disabled_class_seat_waitlist
before insert on private.class_seat_waitlist
for each row execute function private.reject_disabled_class_seat_reservation();

-- Existing SQL definitions are retained for an audited future rollback.
-- Old clients, including an already-open browser tab, cannot create new records.
revoke execute on function public.create_public_class_seat_hold(integer,text,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.create_public_class_seat_hold(integer,text,text,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.join_public_class_seat_waitlist(integer,text,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.join_public_class_seat_waitlist(integer,text,text,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.get_public_class_seat_hold(text)
  from public,anon,authenticated,service_role;
revoke execute on function public.cancel_public_class_seat_hold(text)
  from public,anon,authenticated,service_role;
revoke execute on function public.get_public_class_seat_enrollment_plan()
  from public,anon,authenticated,service_role;
revoke execute on function public.authorize_my_reserved_seat_enrollment(text)
  from public,anon,authenticated,service_role;
revoke execute on function public.complete_my_reserved_seat_enrollment(
  text,text,date,text,text,date,text,text,jsonb
) from public,anon,authenticated,service_role;
revoke execute on function public.start_my_reserved_seat_checkout()
  from public,anon,authenticated,service_role;
revoke execute on function public.assign_teacher_class_seat_hold(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.get_teacher_class_seat_leads()
  from public,anon,authenticated,service_role;
revoke execute on function public.resolve_teacher_class_seat_lead(uuid,text)
  from public,anon,authenticated,service_role;

-- Disable hooks only belonging to this discontinued system.
alter table public.class_students
  disable trigger zz_claim_class_seat_hold_on_membership;
alter table public.class_students
  disable trigger zz_guard_class_seat_holds_on_membership;
alter table public.class_students
  disable trigger zzz_track_reserved_seat_payment_window;
alter table public.profiles
  disable trigger zz_guard_reserved_seat_profile_activation;

-- Both schedules belong exclusively to the retired class-reservation workflow.
-- No payment window is pending at the time of deactivation.
do $$
begin
  if exists (
    select 1 from cron.job
    where jobname='class-waitlist-vacancy-email-every-minute'
  ) then
    perform cron.unschedule('class-waitlist-vacancy-email-every-minute');
  end if;

  if exists (
    select 1 from cron.job
    where jobname='reserved-seat-first-payment-expiration'
  ) then
    perform cron.unschedule('reserved-seat-first-payment-expiration');
  end if;
end;
$$;

revoke all on function private.reject_disabled_class_seat_reservation()
  from public,anon,authenticated;
