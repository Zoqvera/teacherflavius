-- Enrollment may become active inside a BEFORE UPDATE trigger while the
-- original statement updates profile_completed, not enrolled. An UPDATE OF
-- enrolled trigger therefore misses that transition.
--
-- Keep INSERT and UPDATE notifications separate to avoid work on unrelated
-- profile updates. The existing trigger function retains portal-only filtering
-- and the unique student_id outbox constraint prevents duplicate notices.

drop trigger if exists queue_enrollment_email_notification_trigger
  on public.profiles;

drop trigger if exists queue_enrollment_email_notification_on_activation
  on public.profiles;

create trigger queue_enrollment_email_notification_trigger
after insert on public.profiles
for each row
when (new.enrolled is true)
execute function public.queue_enrollment_email_notification();

create trigger queue_enrollment_email_notification_on_activation
after update on public.profiles
for each row
when (
  old.enrolled is distinct from new.enrolled
  and new.enrolled is true
)
execute function public.queue_enrollment_email_notification();
