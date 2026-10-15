-- Queue a separate teacher notification for each confirmed makeup booking.
-- Existing student confirmation and cancellation notifications are unchanged.
alter table public.makeup_class_email_notifications
  drop constraint if exists makeup_class_email_notifications_notification_type_check;

alter table public.makeup_class_email_notifications
  add constraint makeup_class_email_notifications_notification_type_check
  check (notification_type in ('booking_confirmation', 'cancellation', 'teacher_booking'));

create or replace function private.enqueue_teacher_makeup_booking_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.makeup_class_email_notifications (
    booking_id,
    notification_type
  ) values (
    new.booking_id,
    'teacher_booking'
  )
  on conflict (booking_id, notification_type) do nothing;

  return new;
end;
$function$;

revoke all on function private.enqueue_teacher_makeup_booking_email()
  from public, anon, authenticated;

drop trigger if exists enqueue_teacher_makeup_booking_email
  on public.makeup_class_email_notifications;

create trigger enqueue_teacher_makeup_booking_email
after insert on public.makeup_class_email_notifications
for each row
when (new.notification_type = 'booking_confirmation')
execute function private.enqueue_teacher_makeup_booking_email();

comment on function private.enqueue_teacher_makeup_booking_email() is
  'Queues one teacher email when a booking_confirmation is inserted; does not alter student messages.';
