create index trial_lesson_appointments_class_number_idx
  on private.trial_lesson_appointments (class_number)
  where class_number is not null;

create index trial_lesson_appointments_created_by_idx
  on private.trial_lesson_appointments (created_by);
