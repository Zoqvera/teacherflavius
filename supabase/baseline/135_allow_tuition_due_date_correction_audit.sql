-- Recovery overlay for historical tuition due-date audit actions.

alter table public.monthly_tuition_events
  drop constraint if exists monthly_tuition_events_action_check;

alter table public.monthly_tuition_events
  add constraint monthly_tuition_events_action_check
  check (action = any (array[
    'payment_recorded'::text,
    'payment_reversed'::text,
    'payment_reinstated'::text,
    'tuition_exempted'::text,
    'tuition_exemption_reversed'::text,
    'duplicate_payment_detected'::text,
    'due_date_corrected_after_enrollment'::text
  ]));
