alter table private.trial_lesson_appointments
  drop constraint if exists trial_lesson_status_check;

alter table private.trial_lesson_appointments
  add constraint trial_lesson_status_check
  check (status in ('scheduled','completed','cancelled','no_show','historical_unknown'));

alter table private.trial_lesson_appointments
  drop constraint if exists trial_lesson_enrollment_completed_check;

alter table private.trial_lesson_appointments
  add constraint trial_lesson_enrollment_completed_check
  check (
    enrolled_after_trial_at is null
    or status = 'completed'
    or (
      conversion_source = 'automatic'
      and status in ('scheduled','no_show','historical_unknown')
      and starts_at < now()
    )
  );

update private.trial_lesson_appointments
set status = 'historical_unknown',
    updated_at = now()
where status = 'scheduled'
  and starts_at < timestamptz '2026-10-16 03:00:00+00';
